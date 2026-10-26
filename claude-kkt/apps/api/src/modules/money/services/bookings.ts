/**
 * Booking engine (SPEC §12): atomic flat lock + creation with snapshots, parking, other charges and dues catch-up; agreement revision
 * (telescoping recomputation of raised demands); plan change (only while nothing is paid); cancellation; handover.
 * Every function is ONE transaction and writes its audit row inside it.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type {
  AgreementRevisionCreate,
  BookingCancel,
  BookingComplete,
  BookingCreate,
  BookingPlanChange,
  BookingUpdate,
  OtherChargeInput,
} from "@kkt/contracts";
import {
  agreementRevisions,
  blocks,
  bookingCoApplicants,
  bookingOtherCharges,
  bookingPlanRevisions,
  bookings,
  chargeTypes,
  customers,
  demands,
  flatTypes,
  flats,
  parkingSlots,
  payments,
  users,
  type AgreementValues,
  type DB,
  type Executor,
  type FlatSnapshot,
  type PlanSnapshot,
  type Tx,
} from "@kkt/db";
import {
  bpOfPaise,
  formatINR,
  installmentAmounts,
  isHoldExpired,
  normalizeLabel,
  pctOfPaise,
  toBasisPoints,
} from "@kkt/domain";
import { writeAudit } from "../../../lib/audit.js";
import { ApiError } from "../../../lib/errors.js";
import { nextNumber } from "../../../lib/numbering.js";
import { isUniqueViolation } from "../../../lib/pgErrors.js";
import { ensureProjectAccess, type StaffContext } from "../../../lib/scope.js";
import { applyUpdate, assertVersion } from "../../../lib/version.js";
import { notify, notifyRole } from "../../notifications/index.js";
import {
  ACCOUNTS_ROLES,
  Clock,
  loadBooking,
  loadCompanyRow,
  loadTowerStages,
  lockBooking,
  lockFlatAndBlockOf,
  moneyTransaction,
  numberingOf,
  todayDate,
  type BookingRecord,
  type MoneyActor,
} from "../common.js";
import {
  bookingRecipients,
  nonVoidDemands,
  raiseDues,
  raiseOtherChargeDemand,
  recomputeDemandStatuses,
  voidDemand,
} from "./dues.js";
import { appendEvent, demandAmountsFor, events, rebuild } from "./ledger.js";
import { buildPlanSnapshot, resolveBookingPlan } from "./plans.js";

/** Refreshes block/project unit counts through the inventory module when it exports the helper, else with one aggregate statement. */
export async function refreshCounts(tx: Executor, blockId: string): Promise<void> {
  try {
    const mod = (await import("../../inventory/index.js")) as {
      refreshUnitCounts?: (tx: Executor, blockId: string) => Promise<unknown>;
    };
    if (typeof mod.refreshUnitCounts === "function") {
      await mod.refreshUnitCounts(tx, blockId);
      return;
    }
  } catch {
    /* inventory module absent or not loadable: fall through */
  }
  await tx.execute(sql`
    with bc as (
      select count(*) filter (where status = 'AVAILABLE')::int as available, count(*) filter (where status = 'HOLD')::int as hold, count(*) filter (where status = 'BLOCKED')::int as blocked,
             count(*) filter (where status = 'BOOKED')::int as booked, count(*) filter (where status = 'SOLD')::int as sold, count(*)::int as total
      from flats where block_id = ${blockId}::uuid
    ), ub as (
      update blocks b set unit_counts = (select to_jsonb(bc) from bc) where b.id = ${blockId}::uuid returning b.project_id
    ), pc as (
      select count(*) filter (where status = 'AVAILABLE')::int as available, count(*) filter (where status = 'HOLD')::int as hold, count(*) filter (where status = 'BLOCKED')::int as blocked,
             count(*) filter (where status = 'BOOKED')::int as booked, count(*) filter (where status = 'SOLD')::int as sold, count(*)::int as total
      from flats where project_id = (select project_id from ub)
    )
    update projects p set unit_counts = (select to_jsonb(pc) from pc) where p.id = (select project_id from ub)`);
}

/** Validates that every id is an active customer of the company; returns the rows keyed by id. */
async function loadCustomers(
  tx: Executor,
  companyId: string,
  ids: readonly string[],
): Promise<Map<string, typeof customers.$inferSelect>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.companyId, companyId), inArray(customers.id, unique)));
  const byId = new Map(rows.map((c) => [c.id, c]));
  for (const id of unique) {
    const c = byId.get(id);
    if (!c) throw ApiError.invalid("customer_id", "Customer does not exist", "invalid", { customer_id: id });
    if (!c.isActive)
      throw ApiError.rule(`Customer ${c.fullName} is inactive`, "CUSTOMER_INACTIVE", { customer_id: id });
  }
  return byId;
}

/** Builds other-charge line values from the wizard input (GST only on taxable charge types). */
async function buildChargeLines(
  tx: Executor,
  companyId: string,
  inputs: readonly OtherChargeInput[],
): Promise<Omit<typeof bookingOtherCharges.$inferInsert, "companyId" | "bookingId">[]> {
  if (inputs.length === 0) return [];
  const ids = [...new Set(inputs.map((i) => i.charge_type_id))];
  const types = await tx
    .select()
    .from(chargeTypes)
    .where(and(eq(chargeTypes.companyId, companyId), inArray(chargeTypes.id, ids)));
  const byId = new Map(types.map((t) => [t.id, t]));
  return inputs.map((i, idx) => {
    const t = byId.get(i.charge_type_id);
    if (!t)
      throw ApiError.invalid("other_charges", "Unknown charge type", "invalid", { charge_type_id: i.charge_type_id });
    if (!t.isActive) throw ApiError.rule(`Charge type ${t.name} is inactive`, "CHARGE_TYPE_INACTIVE");
    const gstPercent = t.isTaxable ? i.gst_percent : 0;
    const gstPaise = gstPercent > 0 ? pctOfPaise(i.amount_paise, gstPercent) : 0;
    return {
      chargeTypeId: t.id,
      name: t.name,
      code: t.code,
      amountPaise: i.amount_paise,
      gstPercent,
      gstPaise,
      totalPaise: i.amount_paise + gstPaise,
      demandAt: i.demand_at,
      sortOrder: idx + 1,
    };
  });
}

/**
 * AGREEMENT VALUE GUARD (SPEC §12 "total prefilled from the flat's price breakup, editable with permission"): the agreement value must equal
 * the flat's current list price unless the caller holds agreement.edit AND gives a price_deviation_reason; otherwise 422 BUSINESS_RULE
 * PRICE_DEVIATION_NOT_ALLOWED. Returns the deviation to record (null when the booking is at list price).
 */
export function priceDeviation(
  user: Pick<StaffContext, "permissions">,
  listPricePaise: number,
  body: Pick<BookingCreate, "agreement_value_paise" | "price_deviation_reason">,
): { reason: string } | null {
  if (body.agreement_value_paise === listPricePaise) return null;
  const reason = body.price_deviation_reason?.trim() ?? "";
  const canEdit = user.permissions.has("agreement.edit");
  if (!canEdit || reason.length === 0) {
    const missing = [
      ...(canEdit ? [] : ["agreement.edit permission"]),
      ...(reason.length === 0 ? ["price_deviation_reason"] : []),
    ];
    throw ApiError.rule(
      `Agreement value ${formatINR(body.agreement_value_paise)} differs from the flat's list price ${formatINR(listPricePaise)}; a deviation needs ${missing.join(" and ")}`,
      "PRICE_DEVIATION_NOT_ALLOWED",
      {
        field: "agreement_value_paise",
        list_price_paise: listPricePaise,
        agreement_value_paise: body.agreement_value_paise,
        deviation_paise: body.agreement_value_paise - listPricePaise,
        needs: missing,
      },
    );
  }
  return { reason };
}

/**
 * Creates a booking in one transaction (SPEC §12 "on confirm"). Returns the booking id.
 * Lock order: flat row → block row → parking slots (ascending id) → booking number → demand numbers (sequence rows last).
 */
export async function createBooking(
  db: DB,
  user: StaffContext,
  body: BookingCreate,
  actor: MoneyActor,
): Promise<string> {
  const today = todayDate();
  if (body.booking_date > today) throw ApiError.rule("Booking date cannot be in the future", "BOOKING_DATE_FUTURE");
  try {
    return await moneyTransaction(db, async (tx) => {
      const clock = new Clock();
      const company = await loadCompanyRow(tx, user.companyId);
      // ATOMIC FLAT LOCK: the row is locked, the status condition checked and the status changed in this one transaction.
      const [flat] = await tx
        .select()
        .from(flats)
        .where(and(eq(flats.id, body.flat_id), eq(flats.companyId, user.companyId)))
        .limit(1)
        .for("update");
      if (!flat) throw ApiError.notFound("Flat");
      ensureProjectAccess(user, flat.projectId, "Flat");
      // a HOLD past hold_until has lapsed: the flat is AVAILABLE to everybody (the HOLD_EXPIRY job writes the release later)
      const holdOk =
        flat.status === "HOLD" &&
        (flat.holdByUserId === user.id || user.permissions.has("settings.manage") || isHoldExpired(flat));
      if (!(flat.status === "AVAILABLE" || holdOk)) {
        const [other] = flat.bookingId
          ? await tx
              .select({ n: bookings.bookingNumber })
              .from(bookings)
              .where(eq(bookings.id, flat.bookingId))
              .limit(1)
          : [];
        throw ApiError.conflict(
          "FLAT_NOT_AVAILABLE",
          `Flat ${flat.flatNumber} is ${flat.status.toLowerCase()}${flat.status === "HOLD" ? " by another user" : ""}; it cannot be booked`,
          { flat_id: flat.id, current_status: flat.status, booking_number: other?.n ?? null },
        );
      }
      const deviation = priceDeviation(user, flat.pricePaise, body);
      // block row next (unit counts are refreshed on it below; stage completion takes it first too)
      const [block] = await tx.select().from(blocks).where(eq(blocks.id, flat.blockId)).limit(1).for("update");
      if (!block) throw ApiError.notFound("Block");
      const [flatType] = await tx
        .select({ name: flatTypes.name })
        .from(flatTypes)
        .where(eq(flatTypes.id, flat.flatTypeId))
        .limit(1);

      // customer + co-applicants
      const people = await loadCustomers(tx, user.companyId, [body.customer_id, ...body.co_applicant_ids]);
      const customer = people.get(body.customer_id)!;
      if (body.sales_user_id) {
        const [su] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.sales_user_id), eq(users.companyId, user.companyId)))
          .limit(1);
        if (!su) throw ApiError.invalid("sales_user_id", "sales_user_id does not exist");
      }

      // parking: AVAILABLE slots of the same project, locked (ascending id) before any number is allocated
      const slotIds = [...body.parking_slot_ids].sort();
      if (slotIds.length > 0) {
        const slots = await tx
          .select()
          .from(parkingSlots)
          .where(and(eq(parkingSlots.companyId, user.companyId), inArray(parkingSlots.id, slotIds)))
          .orderBy(asc(parkingSlots.id))
          .for("update");
        const byId = new Map(slots.map((s) => [s.id, s]));
        for (const id of body.parking_slot_ids) {
          const s = byId.get(id);
          if (!s || s.projectId !== flat.projectId)
            throw ApiError.invalid("parking_slot_ids", "Parking slot does not belong to the project", "invalid", {
              slot_id: id,
            });
          if (s.status !== "AVAILABLE")
            throw ApiError.conflict("PARKING_NOT_AVAILABLE", `Parking slot ${s.number} is ${s.status.toLowerCase()}`, {
              slot_id: id,
              current_status: s.status,
            });
        }
      }

      // plan: must be applicable to the tower (default when omitted); snapshot with stage names
      const loadedPlan = await resolveBookingPlan(
        tx,
        user.companyId,
        flat.projectId,
        flat.blockId,
        body.booking_date,
        body.payment_plan_id,
      );
      const planSnapshot = buildPlanSnapshot(loadedPlan, company.settings.demand_due_days);
      const lines = await buildChargeLines(tx, user.companyId, body.other_charges);

      const flatSnapshot: FlatSnapshot & { floor_label: string; flat_type_name: string } = {
        flat_number: flat.flatNumber,
        floor: flat.floor,
        floor_label: flat.floorLabel ?? String(flat.floor),
        flat_type_id: flat.flatTypeId,
        flat_type_code: flat.flatTypeCode,
        flat_type_name: flatType?.name ?? flat.flatTypeCode,
        facing: flat.facing,
        carpet_sqft: Number(flat.carpetSqft),
        builtup_sqft: Number(flat.builtupSqft),
        super_builtup_sqft: Number(flat.superBuiltupSqft),
        price_paise: flat.pricePaise,
        price_breakup: flat.priceBreakup,
        rooms: flat.roomsSnapshot,
        areas: flat.areasSnapshot,
      };
      // every row lock is held: the booking number (sequence row) is allocated now
      const bookingNumber = await nextNumber(tx, numberingOf(company), "booking", body.booking_date);
      const [booking] = await tx
        .insert(bookings)
        .values({
          companyId: user.companyId,
          bookingNumber,
          projectId: flat.projectId,
          blockId: flat.blockId,
          flatId: flat.id,
          customerId: body.customer_id,
          bookingDate: body.booking_date,
          status: "ACTIVE",
          agreementValuePaise: body.agreement_value_paise,
          cashAgreedPaise: body.cash_agreed_paise,
          accountAgreedPaise: body.account_agreed_paise,
          listPricePaise: flat.pricePaise,
          priceDeviationReason: deviation?.reason ?? null,
          priceDeviationBy: deviation ? user.id : null,
          flatSnapshot,
          ratePerSqftPaise: flat.ratePerSqftPaise,
          paymentPlanId: loadedPlan.plan.id,
          planSnapshot,
          planAcceptedOn: body.plan_accepted_on,
          planAcceptanceMode: body.plan_acceptance_mode,
          planAcceptanceDocumentId: body.plan_acceptance_document_id ?? null,
          salesUserId: body.sales_user_id ?? null,
          leadId: body.lead_id ?? null,
          brokerName: body.broker_name ?? null,
          remarks: body.remarks ?? null,
          createdBy: user.id,
        })
        .returning();
      if (!booking) throw new Error("booking insert returned no row");
      if (body.co_applicant_ids.length > 0)
        await tx
          .insert(bookingCoApplicants)
          .values(body.co_applicant_ids.map((customerId) => ({ bookingId: booking.id, customerId })));
      if (slotIds.length > 0)
        await tx
          .update(parkingSlots)
          .set({ status: "ALLOTTED", bookingId: booking.id, version: sql`${parkingSlots.version} + 1` })
          .where(inArray(parkingSlots.id, slotIds));

      // flat → BOOKED (set only by the engine); unit counts on the (already locked) block and its project
      await tx
        .update(flats)
        .set({
          status: "BOOKED",
          bookingId: booking.id,
          holdByUserId: null,
          holdUntil: null,
          statusChangedAt: new Date(),
          statusChangedBy: user.id,
          version: sql`${flats.version} + 1`,
        })
        .where(eq(flats.id, flat.id));
      await refreshCounts(tx, flat.blockId);

      // other charges (GST only on taxable types); ON_BOOKING lines are demanded now
      if (lines.length > 0) {
        const inserted = await tx
          .insert(bookingOtherCharges)
          .values(lines.map((l) => ({ ...l, companyId: user.companyId, bookingId: booking.id })))
          .returning();
        for (const line of inserted)
          if (line.demandAt === "ON_BOOKING")
            await raiseOtherChargeDemand(tx, booking, line, {
              today,
              actor,
              clock,
              company,
              dueDate: addDaysStr(body.booking_date, company.settings.demand_due_days),
            });
      }

      // dues catch-up: ON_BOOKING + every already-satisfied stage/time installment
      await raiseDues(tx, booking, { today, actor, clock, company });

      await writeAudit(tx, {
        companyId: user.companyId,
        actor,
        action: "booking.create",
        entityType: "booking",
        entityId: booking.id,
        after: {
          booking_number: bookingNumber,
          flat_id: flat.id,
          flat_number: flat.flatNumber,
          customer_id: body.customer_id,
          agreement_value_paise: body.agreement_value_paise,
          list_price_paise: flat.pricePaise,
          cash_agreed_paise: body.cash_agreed_paise,
          account_agreed_paise: body.account_agreed_paise,
          payment_plan_id: loadedPlan.plan.id,
          plan_acceptance_mode: body.plan_acceptance_mode,
        },
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      });
      if (deviation) {
        await writeAudit(tx, {
          companyId: user.companyId,
          actor,
          action: "booking.price_deviation",
          entityType: "booking",
          entityId: booking.id,
          before: { list_price_paise: flat.pricePaise },
          after: {
            agreement_value_paise: body.agreement_value_paise,
            deviation_paise: body.agreement_value_paise - flat.pricePaise,
            reason: deviation.reason,
            flat_number: flat.flatNumber,
          },
          ip: actor.ip ?? null,
          requestId: actor.requestId ?? null,
        });
      }
      await notify(tx, {
        companyId: user.companyId,
        recipients: await bookingRecipients(tx, booking),
        type: "BOOKING_CREATED",
        title: `Booking ${bookingNumber} confirmed`,
        body: `${flat.flatNumber}, ${block.name} – agreement ${formatINR(body.agreement_value_paise)} (${loadedPlan.plan.name})`,
        entityType: "booking",
        entityId: booking.id,
        link: `/bookings/${booking.id}`,
      });
      void customer;
      return booking.id;
    });
  } catch (err) {
    // The partial unique index (one ACTIVE booking per flat) is the last line of defence under concurrency.
    if (isUniqueViolation(err)) {
      const [flat] = await db
        .select({ id: flats.id, status: flats.status, bookingId: flats.bookingId })
        .from(flats)
        .where(eq(flats.id, body.flat_id))
        .limit(1);
      const [other] = flat?.bookingId
        ? await db.select({ n: bookings.bookingNumber }).from(bookings).where(eq(bookings.id, flat.bookingId)).limit(1)
        : [];
      throw ApiError.conflict("FLAT_NOT_AVAILABLE", "The flat was booked by someone else a moment ago", {
        flat_id: body.flat_id,
        current_status: flat?.status ?? "BOOKED",
        booking_number: other?.n ?? null,
      });
    }
    throw err;
  }
}

function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Loads an ACTIVE booking inside the user's scope, locked for update; 404 outside scope, 409 BOOKING_NOT_ACTIVE otherwise. */
export async function loadActiveBooking(
  tx: Tx,
  user: StaffContext,
  id: string,
  opts: { allowInactive?: boolean } = {},
): Promise<BookingRecord> {
  const b = await loadBooking(tx, user.companyId, id, true);
  ensureProjectAccess(user, b.projectId, "Booking");
  if (!opts.allowInactive && b.status !== "ACTIVE")
    throw ApiError.conflict("BOOKING_NOT_ACTIVE", `Booking ${b.bookingNumber} is ${b.status.toLowerCase()}`, {
      status: b.status,
    });
  return b;
}

/**
 * Agreement revision (SPEC §12): each bucket's new agreed value must be ≥ that bucket's paid amount (409 BELOW_PAID); the revision is stored
 * before/after; every non-void demand is recomputed with telescoping from the new agreed values; AGREEMENT_CHANGE row carries the adjustment.
 */
export async function reviseAgreement(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: AgreementRevisionCreate,
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    const b = await loadActiveBooking(tx, user, bookingId);
    const clock = new Clock();
    await lockBooking(tx, b.id, clock);
    if (body.cash_agreed_paise < b.cashPaidPaise)
      throw ApiError.conflict(
        "BELOW_PAID",
        `Cash agreed ${formatINR(body.cash_agreed_paise)} is below the ${formatINR(b.cashPaidPaise)} already received in the Cash bucket`,
        { bucket: "CASH", paid_paise: b.cashPaidPaise, agreed_paise: body.cash_agreed_paise },
      );
    if (body.account_agreed_paise < b.accountPaidPaise)
      throw ApiError.conflict(
        "BELOW_PAID",
        `Account agreed ${formatINR(body.account_agreed_paise)} is below the ${formatINR(b.accountPaidPaise)} already received in the Account bucket`,
        { bucket: "ACCOUNT", paid_paise: b.accountPaidPaise, agreed_paise: body.account_agreed_paise },
      );
    const before: AgreementValues = {
      agreement_value_paise: b.agreementValuePaise,
      cash_agreed_paise: b.cashAgreedPaise,
      account_agreed_paise: b.accountAgreedPaise,
    };
    const after: AgreementValues = {
      agreement_value_paise: body.agreement_value_paise,
      cash_agreed_paise: body.cash_agreed_paise,
      account_agreed_paise: body.account_agreed_paise,
    };
    const revisedAt = clock.next();
    const [rev] = await tx
      .insert(agreementRevisions)
      .values({
        companyId: b.companyId,
        bookingId: b.id,
        revisedAt,
        revisedBy: user.id,
        revisedByName: user.name,
        reason: body.reason,
        before,
        after,
      })
      .returning();
    if (!rev) throw new Error("revision insert returned no row");
    await applyUpdate(
      tx,
      bookings,
      b.id,
      body.version,
      {
        agreementValuePaise: after.agreement_value_paise,
        cashAgreedPaise: after.cash_agreed_paise,
        accountAgreedPaise: after.account_agreed_paise,
      },
      "booking",
    );
    // recompute every non-void demand (telescoping) and the adjustment to the raised figures
    const existing = await nonVoidDemands(tx, b.id);
    let cashAdj = 0;
    let accountAdj = 0;
    for (const d of existing) {
      const was = demandAmountsFor(d, before);
      const now = demandAmountsFor(d, after);
      cashAdj += now.cashPaise - was.cashPaise;
      accountAdj += now.accountPaise - was.accountPaise;
      if (now.cashPaise !== d.cashDemandPaise || now.accountPaise !== d.accountDemandPaise) {
        await tx
          .update(demands)
          .set({
            cashDemandPaise: now.cashPaise,
            accountDemandPaise: now.accountPaise,
            totalDemandPaise: now.cashPaise + now.accountPaise,
          })
          .where(eq(demands.id, d.id));
      }
    }
    await appendEvent(
      tx,
      b.id,
      events.agreementChange(
        { id: rev.id, revisedAt, reason: body.reason, after },
        { cash: cashAdj, account: accountAdj },
      ),
    );
    await rebuild(tx, b.id, { write: true });
    await recomputeDemandStatuses(tx, b.id);
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "booking.agreement_revise",
      entityType: "booking",
      entityId: b.id,
      before: { ...before },
      after: { ...after, reason: body.reason },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    await notifyRole(tx, b.companyId, ACCOUNTS_ROLES, {
      type: "AGREEMENT_REVISED",
      title: `Agreement revised on ${b.bookingNumber}`,
      body: `Cash ${formatINR(after.cash_agreed_paise)} / Account ${formatINR(after.account_agreed_paise)} – ${body.reason}`,
      entityType: "booking",
      entityId: b.id,
      link: `/bookings/${b.id}`,
    });
    await notify(tx, {
      companyId: b.companyId,
      recipients: await bookingRecipients(tx, b),
      type: "AGREEMENT_REVISED",
      title: "Your agreement has been revised",
      body: `Cash ${formatINR(after.cash_agreed_paise)} / Account ${formatINR(after.account_agreed_paise)}`,
      entityType: "booking",
      entityId: b.id,
      link: `/bookings/${b.id}`,
    });
  });
}

/**
 * Plan change (SPEC §10): only while no installment demand has been paid (409 PLAN_CHANGE_BLOCKED). Existing demands are voided,
 * the new plan is snapshotted, a revision row + PLAN_CHANGE ledger row are written and dues are re-raised (catch-up) from the new plan.
 */
export async function changePlan(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: BookingPlanChange,
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    const b = await loadActiveBooking(tx, user, bookingId);
    const clock = new Clock();
    await lockBooking(tx, b.id, clock);
    const existing = await nonVoidDemands(tx, b.id);
    const paid = existing.filter((d) => d.paidPaise > 0);
    if (paid.length > 0)
      throw ApiError.conflict(
        "PLAN_CHANGE_BLOCKED",
        `Installment demand ${paid[0]!.demandNumber} has been paid; the plan can no longer be changed`,
        { paid_demand_numbers: paid.map((d) => d.demandNumber) },
      );
    const company = await loadCompanyRow(tx, b.companyId);
    const loaded = await resolveBookingPlan(tx, b.companyId, b.projectId, b.blockId, todayDate(), body.payment_plan_id);
    if (loaded.plan.id === b.paymentPlanId) throw ApiError.rule("The booking already uses this plan", "SAME_PLAN");
    const after = buildPlanSnapshot(loaded, company.settings.demand_due_days);
    for (const d of existing) await voidDemand(tx, d, `Plan changed to ${loaded.plan.name}: ${body.reason}`, actor);
    const at = clock.next();
    const [rev] = await tx
      .insert(bookingPlanRevisions)
      .values({
        companyId: b.companyId,
        bookingId: b.id,
        at,
        by: user.id,
        reason: body.reason,
        beforePlanSnapshot: b.planSnapshot,
        afterPlanSnapshot: after,
      })
      .returning();
    if (!rev) throw new Error("plan revision insert returned no row");
    await applyUpdate(
      tx,
      bookings,
      b.id,
      body.version,
      {
        paymentPlanId: loaded.plan.id,
        planSnapshot: after as PlanSnapshot,
        ...(body.plan_acceptance_mode ? { planAcceptanceMode: body.plan_acceptance_mode } : {}),
        ...(body.plan_accepted_on ? { planAcceptedOn: body.plan_accepted_on } : {}),
        ...(body.plan_acceptance_document_id !== undefined
          ? { planAcceptanceDocumentId: body.plan_acceptance_document_id }
          : {}),
      },
      "booking",
    );
    // voided demands leave the ledger; the PLAN_CHANGE marker row is derived from the revision; then catch-up from the new plan
    await rebuild(tx, b.id, { write: true });
    const fresh = await loadBooking(tx, b.companyId, b.id);
    await raiseDues(tx, fresh, { today: todayDate(), actor, clock, company });
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "booking.plan_change",
      entityType: "booking",
      entityId: b.id,
      before: { payment_plan_id: b.paymentPlanId, plan: b.planSnapshot.name },
      after: {
        payment_plan_id: loaded.plan.id,
        plan: loaded.plan.name,
        reason: body.reason,
        voided_demands: existing.map((d) => d.demandNumber),
      },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  });
}

/** Cancellation (SPEC §12): refund ≤ paid, no pending cheques; open demands → CANCELLED; flat/parking → AVAILABLE; ledger closed. */
export async function cancelBooking(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: BookingCancel,
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    await lockFlatAndBlockOf(tx, user.companyId, bookingId);
    const b = await loadActiveBooking(tx, user, bookingId);
    const clock = new Clock();
    await lockBooking(tx, b.id, clock);
    const pending = await tx
      .select({ receipt: payments.receiptNumber })
      .from(payments)
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, "PENDING")));
    if (pending.length > 0)
      throw ApiError.conflict(
        "PENDING_PAYMENTS",
        `Clear or bounce pending instruments first: ${pending.map((p) => p.receipt).join(", ")}`,
        { receipt_numbers: pending.map((p) => p.receipt) },
      );
    const totalPaid = b.cashPaidPaise + b.accountPaidPaise + b.otherChargesPaidPaise;
    if (body.refund_paise > totalPaid)
      throw ApiError.conflict(
        "REFUND_EXCEEDS_PAID",
        `Refund ${formatINR(body.refund_paise)} exceeds the ${formatINR(totalPaid)} received`,
        { paid_paise: totalPaid, refund_paise: body.refund_paise },
      );
    if (body.refund_paise + body.deduction_paise > totalPaid)
      throw ApiError.rule("Refund + deduction cannot exceed the amount received", "REFUND_PLUS_DEDUCTION", {
        paid_paise: totalPaid,
      });
    const at = clock.next().toISOString();
    const cancellation = {
      at,
      by: user.id,
      by_name: user.name,
      reason: body.reason,
      deduction_paise: body.deduction_paise,
      refund_paise: body.refund_paise,
    };
    await tx
      .update(demands)
      .set({ status: "CANCELLED" })
      .where(and(eq(demands.bookingId, b.id), inArray(demands.status, ["OPEN", "PARTIALLY_PAID"])));
    await applyUpdate(
      tx,
      bookings,
      b.id,
      body.version,
      {
        status: "CANCELLED",
        cancellation,
        // money columns (migration 0005); the jsonb keeps the full record
        cancellationRefundPaise: body.refund_paise,
        cancellationDeductionPaise: body.deduction_paise,
      },
      "booking",
    );
    await appendEvent(tx, b.id, events.cancellation(cancellation));
    await tx
      .update(flats)
      .set({
        status: "AVAILABLE",
        bookingId: null,
        statusChangedAt: new Date(),
        statusChangedBy: user.id,
        version: sql`${flats.version} + 1`,
      })
      .where(and(eq(flats.id, b.flatId), eq(flats.bookingId, b.id)));
    await tx
      .update(parkingSlots)
      .set({ status: "AVAILABLE", bookingId: null, version: sql`${parkingSlots.version} + 1` })
      .where(eq(parkingSlots.bookingId, b.id));
    await refreshCounts(tx, b.blockId);
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "booking.cancel",
      entityType: "booking",
      entityId: b.id,
      before: { status: "ACTIVE" },
      after: { status: "CANCELLED", ...cancellation },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    await notifyRole(tx, b.companyId, ACCOUNTS_ROLES, {
      type: "BOOKING_CANCELLED",
      title: `Booking ${b.bookingNumber} cancelled`,
      body: `${body.reason} – refund ${formatINR(body.refund_paise)}, deduction ${formatINR(body.deduction_paise)}`,
      entityType: "booking",
      entityId: b.id,
      link: `/bookings/${b.id}`,
    });
    await notify(tx, {
      companyId: b.companyId,
      recipients: await bookingRecipients(tx, b),
      type: "BOOKING_CANCELLED",
      title: `Booking ${b.bookingNumber} has been cancelled`,
      body: body.reason,
      entityType: "booking",
      entityId: b.id,
      link: `/bookings/${b.id}`,
    });
  });
}

/**
 * Handover (SPEC §12): possession stage COMPLETED, total due ≤ 0, other charges due ≤ 0, no pending cheques → COMPLETED, flat SOLD.
 * Hardened against plan ↔ tower drift: every installment of the plan snapshot must have been raised AND each bucket's agreed value
 * must be fully received (agreed − paid ≤ 0 per bucket), so a buyer is never handed over short of the agreed value because an
 * installment could not be raised. Every problem is listed in 409 HANDOVER_BLOCKED.
 */
export async function completeBooking(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: BookingComplete,
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    await lockFlatAndBlockOf(tx, user.companyId, bookingId);
    const b = await loadActiveBooking(tx, user, bookingId);
    await lockBooking(tx, b.id);
    const stages = await loadTowerStages(tx, b.blockId);
    const possession = stages.find((s) => s.isPossession);
    const problems: string[] = [];
    if (!possession) problems.push("The tower has no possession stage");
    else if (possession.status !== "COMPLETED")
      problems.push(`Possession stage "${possession.name ?? "Possession"}" is not completed`);
    const existing = await nonVoidDemands(tx, b.id);
    const raisedSeqs = new Set(existing.map((d) => d.installmentSeq));
    const raisedNames = new Set(existing.map((d) => normalizeLabel(d.installmentName)));
    const unraised = b.planSnapshot.installments.filter(
      (i) => !raisedSeqs.has(i.seq) && !raisedNames.has(normalizeLabel(i.name)),
    );
    for (const i of unraised) problems.push(`Installment ${i.seq} "${i.name}" has not been raised`);
    const cashShort = b.cashAgreedPaise - b.cashPaidPaise;
    const accountShort = b.accountAgreedPaise - b.accountPaidPaise;
    if (cashShort > 0)
      problems.push(
        `Cash bucket: ${formatINR(cashShort)} of the ${formatINR(b.cashAgreedPaise)} agreed is not yet received`,
      );
    if (accountShort > 0)
      problems.push(
        `Account bucket: ${formatINR(accountShort)} of the ${formatINR(b.accountAgreedPaise)} agreed is not yet received`,
      );
    const totalDue = b.cashOrderRaisedPaise - b.cashPaidPaise + (b.accountOrderRaisedPaise - b.accountPaidPaise);
    if (totalDue > 0) problems.push(`Total due ${formatINR(totalDue)} must be ≤ 0`);
    const otherDue = b.otherChargesDemandedPaise - b.otherChargesPaidPaise;
    if (otherDue > 0) problems.push(`Other charges due ${formatINR(otherDue)} must be ≤ 0`);
    if (b.pendingChequesPaise > 0)
      problems.push(`Pending cheques ${formatINR(b.pendingChequesPaise)} must be cleared or bounced`);
    if (problems.length > 0) {
      throw ApiError.conflict("HANDOVER_BLOCKED", `Handover is blocked: ${problems.join("; ")}`, {
        problems,
        unraised_installments: unraised.map((i) => ({ seq: i.seq, name: i.name })),
        cash_short_paise: Math.max(0, cashShort),
        account_short_paise: Math.max(0, accountShort),
      });
    }
    const completedAt = body.completed_on ? new Date(`${body.completed_on}T00:00:00+05:30`) : new Date();
    await applyUpdate(
      tx,
      bookings,
      b.id,
      body.version,
      { status: "COMPLETED", completedAt, completedBy: user.id, completionNotes: body.completion_notes ?? null },
      "booking",
    );
    await tx
      .update(flats)
      .set({
        status: "SOLD",
        statusChangedAt: new Date(),
        statusChangedBy: user.id,
        version: sql`${flats.version} + 1`,
      })
      .where(and(eq(flats.id, b.flatId), eq(flats.bookingId, b.id)));
    await refreshCounts(tx, b.blockId);
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "booking.complete",
      entityType: "booking",
      entityId: b.id,
      before: { status: "ACTIVE" },
      after: {
        status: "COMPLETED",
        completed_at: completedAt.toISOString(),
        completion_notes: body.completion_notes ?? null,
      },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    await notify(tx, {
      companyId: b.companyId,
      recipients: await bookingRecipients(tx, b),
      type: "BOOKING_CREATED",
      title: `Congratulations – ${b.bookingNumber} handed over`,
      body: "Your booking is complete and the flat is registered as sold to you.",
      entityType: "booking",
      entityId: b.id,
      link: `/bookings/${b.id}`,
    });
  });
}

/**
 * Reopens a COMPLETED booking inside the caller's unit of work (a reversal by a settings.manage holder, SPEC §11 + TODO-integration #7):
 * booking → ACTIVE (completion data cleared), flat SOLD → BOOKED, unit counts refreshed, audit booking.reopened with the reason, so
 * the dues the reversal creates are visible to every ACTIVE-only view (lists, overdue job, portal) again.
 * The caller holds payment → flat → block → booking locks already.
 */
export async function reopenCompletedBooking(
  tx: Tx,
  b: BookingRecord,
  user: Pick<StaffContext, "id">,
  reason: string,
  actor: MoneyActor,
): Promise<BookingRecord> {
  const [reopened] = await tx
    .update(bookings)
    .set({
      status: "ACTIVE",
      completedAt: null,
      completedBy: null,
      version: sql`${bookings.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(bookings.id, b.id), eq(bookings.status, "COMPLETED")))
    .returning();
  if (!reopened)
    throw ApiError.conflict("BOOKING_NOT_ACTIVE", `Booking ${b.bookingNumber} is ${b.status.toLowerCase()}`, {
      status: b.status,
    });
  await tx
    .update(flats)
    .set({
      status: "BOOKED",
      statusChangedAt: new Date(),
      statusChangedBy: user.id,
      version: sql`${flats.version} + 1`,
    })
    .where(and(eq(flats.id, b.flatId), eq(flats.bookingId, b.id), eq(flats.status, "SOLD")));
  await refreshCounts(tx, b.blockId);
  await writeAudit(tx, {
    companyId: b.companyId,
    actor,
    action: "booking.reopened",
    entityType: "booking",
    entityId: b.id,
    before: { status: "COMPLETED", completed_at: b.completedAt?.toISOString() ?? null, flat_status: "SOLD" },
    after: { status: "ACTIVE", flat_status: "BOOKED", reason },
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
  });
  return reopened;
}

/** Adds an other-charge line to an active booking (demanded now when its rule is ON_BOOKING). */
export async function addOtherCharge(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: OtherChargeInput & { version: number },
  actor: MoneyActor,
): Promise<string> {
  return moneyTransaction(db, async (tx) => {
    const b = await loadActiveBooking(tx, user, bookingId);
    const [line] = await buildChargeLines(tx, b.companyId, [body]);
    const [maxSort] = await tx
      .select({ n: sql<number>`coalesce(max(${bookingOtherCharges.sortOrder}), 0)::int` })
      .from(bookingOtherCharges)
      .where(eq(bookingOtherCharges.bookingId, b.id));
    const [inserted] = await tx
      .insert(bookingOtherCharges)
      .values({ ...line!, sortOrder: Number(maxSort?.n ?? 0) + 1, companyId: b.companyId, bookingId: b.id })
      .returning();
    if (!inserted) throw new Error("other charge insert returned no row");
    await applyUpdate(tx, bookings, b.id, body.version, {}, "booking");
    if (inserted.demandAt === "ON_BOOKING") await raiseOtherChargeDemand(tx, b, inserted, { actor });
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "other_charge.add",
      entityType: "booking_other_charge",
      entityId: inserted.id,
      after: { booking_id: b.id, name: inserted.name, total_paise: inserted.totalPaise, demand_at: inserted.demandAt },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
    return inserted.id;
  });
}

/** Raises a manual other-charge demand (or an undemanded ON_POSSESSION/ON_BOOKING line) now. */
export async function demandOtherChargeLine(
  db: DB,
  user: StaffContext,
  bookingId: string,
  lineId: string,
  body: { version: number; due_date?: string | undefined; line_version?: number | undefined },
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    const b = await loadActiveBooking(tx, user, bookingId);
    const [line] = await tx
      .select()
      .from(bookingOtherCharges)
      .where(and(eq(bookingOtherCharges.id, lineId), eq(bookingOtherCharges.bookingId, b.id)))
      .for("update")
      .limit(1);
    if (!line) throw ApiError.notFound("Other charge line");
    if (body.line_version !== undefined)
      await assertVersion(tx, bookingOtherCharges, line.id, line.version, body.line_version, "booking");
    if (line.demandedAt)
      throw ApiError.conflict("ALREADY_DEMANDED", `${line.name} was already demanded as ${line.demandNumber}`, {
        demand_number: line.demandNumber,
      });
    await applyUpdate(tx, bookings, b.id, body.version, {}, "booking");
    await raiseOtherChargeDemand(tx, b, line, { actor, dueDate: body.due_date });
  });
}

/** Updates remarks / sales user / broker / co-applicants. */
export async function updateBooking(
  db: DB,
  user: StaffContext,
  bookingId: string,
  body: BookingUpdate,
  actor: MoneyActor,
): Promise<void> {
  await moneyTransaction(db, async (tx) => {
    const b = await loadActiveBooking(tx, user, bookingId, { allowInactive: true });
    const changes: Record<string, unknown> = {};
    if (body.remarks !== undefined) changes["remarks"] = body.remarks;
    if (body.broker_name !== undefined) changes["brokerName"] = body.broker_name;
    if (body.sales_user_id !== undefined) changes["salesUserId"] = body.sales_user_id;
    if (body.co_applicant_ids) {
      if (body.co_applicant_ids.includes(b.customerId))
        throw ApiError.invalid("co_applicant_ids", "Primary applicant cannot also be a co-applicant");
      await loadCustomers(tx, b.companyId, body.co_applicant_ids);
      await tx.delete(bookingCoApplicants).where(eq(bookingCoApplicants.bookingId, b.id));
      if (body.co_applicant_ids.length > 0)
        await tx
          .insert(bookingCoApplicants)
          .values([...new Set(body.co_applicant_ids)].map((customerId) => ({ bookingId: b.id, customerId })));
    }
    await applyUpdate(tx, bookings, b.id, body.version, changes, "booking");
    await writeAudit(tx, {
      companyId: b.companyId,
      actor,
      action: "booking.update",
      entityType: "booking",
      entityId: b.id,
      before: { remarks: b.remarks, broker_name: b.brokerName, sales_user_id: b.salesUserId },
      after: { ...body },
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
    });
  });
}

/** Telescoping amounts of every installment for given agreed values (exported for tests and the integrity report). */
export function expectedInstallmentAmounts(snapshot: PlanSnapshot, cashAgreed: number, accountAgreed: number) {
  return installmentAmounts(
    cashAgreed,
    accountAgreed,
    snapshot.installments.map((i) => ({ seq: i.seq, percent: i.percent })),
  );
}

/** Re-exported helpers used by the routes. */
export { bpOfPaise, toBasisPoints, asc, ne };
