import { ArrowRightLeft, ExternalLink, History, IndianRupee, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FLAT_STATUS_LABELS,
  MANUAL_FLAT_STATUSES,
  type FlatDetailResponse,
  type FlatTypeRow,
  type ManualFlatStatus,
} from "@kkt/contracts";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  FieldWrapper,
  KeyValueList,
  MoneyInput,
  NumberInput,
  Select,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Timeline,
  type TimelineItem,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatINR, formatNumber, formatSqft } from "@/lib/format";
import { useMutationWithToast } from "@/lib/queries";
import { humanize, useOnChange } from "@/lib/utils";
import { useMasterRows } from "@/features/masters/api";
import { BLOCKS_PATH, FLATS_PATH, inventoryKeys, PROJECTS_PATH, useFlatDetail } from "./api";
import { Notice } from "./components";
import { hoursFromNow } from "./inventoryMath";

export interface FlatDrawerProps {
  flatId: string | null;
  onClose: () => void;
}

/** Flat details: snapshots, specs, price breakup, parking, status/type/price/notes actions and history. */
export function FlatDrawer({ flatId, onClose }: FlatDrawerProps) {
  const flat = useFlatDetail(flatId);
  return (
    <Sheet open={flatId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent size="lg" data-testid="flat-drawer">
        {flat.isPending && (
          <>
            <SheetHeader>
              <SheetTitle>
                <Skeleton className="h-6 w-40" />
              </SheetTitle>
              <SheetDescription className="sr-only">Loading flat</SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-40" />
            </SheetBody>
          </>
        )}
        {flat.isError && (
          <>
            <SheetHeader>
              <SheetTitle>Flat</SheetTitle>
              <SheetDescription className="sr-only">Error</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <ErrorState error={flat.error} onRetry={() => void flat.refetch()} compact />
            </SheetBody>
          </>
        )}
        {flat.data && <FlatDrawerBody flat={flat.data} />}
      </SheetContent>
    </Sheet>
  );
}

function FlatDrawerBody({ flat }: { flat: FlatDetailResponse }) {
  const { can } = useAuth();
  const canStatus = can("flat.status");
  const canWrite = can("flat.write");
  const invalidate = useMemo(
    () => [inventoryKeys.flatDetail(flat.id), [FLATS_PATH], [BLOCKS_PATH], [PROJECTS_PATH]],
    [flat.id],
  );

  const specsByCategory = useMemo(() => {
    const map = new Map<string, FlatDetailResponse["specifications"]>();
    for (const spec of flat.specifications) {
      const list = map.get(spec.category) ?? [];
      list.push(spec);
      map.set(spec.category, list);
    }
    return [...map.entries()];
  }, [flat.specifications]);

  const total = flat.price_breakup.reduce((sum, line) => sum + line.amount_paise, 0);
  const booked = flat.status === "BOOKED" || flat.status === "SOLD";

  const history: TimelineItem[] = flat.history.map((entry, index) => ({
    id: `${entry.at}-${index}`,
    title: humanize(entry.action.replace(/^flat\./, "")),
    at: entry.at,
    actor: entry.actor_name,
    tone: entry.action.includes("status") ? "warning" : entry.action.includes("price") ? "gold" : "neutral",
    description:
      entry.after && typeof entry.after.status === "string"
        ? `→ ${FLAT_STATUS_LABELS[entry.after.status as keyof typeof FLAT_STATUS_LABELS] ?? String(entry.after.status)}`
        : undefined,
  }));

  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>Flat {flat.flat_number}</SheetTitle>
          <StatusChip status={flat.status} label={FLAT_STATUS_LABELS[flat.status]} />
          <Badge variant="outline" numeric>
            v{flat.version}
          </Badge>
        </div>
        <SheetDescription>
          {flat.block_name} · Floor {flat.floor_label} · Position {flat.position} · {flat.flat_type_code}{" "}
          {flat.flat_type_name} ({flat.bhk} BHK)
          {flat.facing ? ` · ${flat.facing} facing` : ""}
          {flat.is_corner ? " · corner" : ""}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Price" value={formatINR(flat.price_paise)} />
          <Stat
            label="Rate / sq ft"
            value={flat.rate_per_sqft_paise !== null ? formatINR(flat.rate_per_sqft_paise) : "—"}
          />
          <Stat label="Super built-up" value={formatSqft(flat.super_builtup_sqft)} />
          <Stat label="Carpet" value={flat.carpet_sqft !== null ? formatSqft(flat.carpet_sqft) : "—"} />
        </div>

        {flat.status === "HOLD" && (
          <Notice tone="warning">
            On hold{flat.hold_by_name ? ` by ${flat.hold_by_name}` : ""}
            {flat.hold_until ? ` until ${formatDateTime(flat.hold_until)}` : ""}.
          </Notice>
        )}
        {booked && flat.booking_id && (
          <Notice tone="info">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {FLAT_STATUS_LABELS[flat.status]} · {flat.booking_number ?? "Booking"}
                {flat.customer_name ? ` · ${flat.customer_name}` : ""}
              </span>
              <Link
                to={`/bookings/${flat.booking_id}`}
                className="inline-flex items-center gap-1 font-semibold hover:underline"
              >
                Open booking <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </span>
          </Notice>
        )}

        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="price">Price</TabsTrigger>
            {(canStatus || canWrite) && <TabsTrigger value="actions">Actions</TabsTrigger>}
            <TabsTrigger
              value="history"
              count={flat.history.length}
              icon={<History className="size-3.5" aria-hidden="true" />}
            >
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-5">
            <section>
              <h4 className="label-caps mb-2">Rooms (snapshot)</h4>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[22rem] text-sm">
                  <thead className="bg-surface text-left text-2xs uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-3 py-1.5 font-semibold">Room</th>
                      <th className="px-3 py-1.5 font-semibold">Type</th>
                      <th className="px-3 py-1.5 text-right font-semibold">L × W (ft)</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Sq ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flat.rooms_snapshot.map((room, index) => (
                      <tr key={`${room.label}-${index}`} className="border-t border-border">
                        <td className="px-3 py-1.5 font-medium">{room.label}</td>
                        <td className="px-3 py-1.5 text-ink-muted">{room.room_type_name}</td>
                        <td className="money px-3 py-1.5 text-right">
                          {room.length_ft} × {room.width_ft}
                        </td>
                        <td className="money px-3 py-1.5 text-right">
                          {formatNumber(room.sqft, Number.isInteger(room.sqft) ? 0 : 2)}
                        </td>
                      </tr>
                    ))}
                    {flat.rooms_snapshot.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-center text-xs text-ink-subtle">
                          No rooms snapshotted
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h4 className="label-caps mb-2">Areas</h4>
              <KeyValueList
                layout="inline"
                items={flat.areas_snapshot.map((area) => ({
                  label: area.area_type_name,
                  value: formatSqft(area.sqft),
                  numeric: true,
                }))}
                emptyText="—"
              />
              {flat.areas_snapshot.length === 0 && <p className="text-xs text-ink-subtle">No areas snapshotted.</p>}
            </section>
            <section>
              <h4 className="label-caps mb-2">Specifications</h4>
              {specsByCategory.length === 0 ? (
                <p className="text-xs text-ink-subtle">No specification items on this flat type.</p>
              ) : (
                <div className="space-y-2">
                  {specsByCategory.map(([category, specs]) => (
                    <div key={category}>
                      <p className="text-xs font-semibold text-navy-950">{category}</p>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm text-ink">
                        {specs.map((spec) => (
                          <li key={spec.name}>
                            {spec.name}
                            {spec.description && <span className="text-ink-subtle"> — {spec.description}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section>
              <h4 className="label-caps mb-2">Parking</h4>
              {flat.parking_slot_numbers.length === 0 ? (
                <p className="text-xs text-ink-subtle">No parking allotted.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {flat.parking_slot_numbers.map((slot) => (
                    <Badge key={slot} variant="navy">
                      {slot}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
            <NotesEditor flat={flat} canWrite={canWrite} invalidate={invalidate} />
          </TabsContent>

          <TabsContent value="price">
            <div className="rounded-md border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {flat.price_breakup.map((line, index) => (
                    <tr key={`${line.label}-${index}`} className={index > 0 ? "border-t border-border" : undefined}>
                      <td className="px-3 py-2">{line.label}</td>
                      <td className="money px-3 py-2 text-right">{formatINR(line.amount_paise)}</td>
                    </tr>
                  ))}
                  {flat.price_breakup.length === 0 && (
                    <tr>
                      <td className="px-3 py-2 text-ink-muted">Price</td>
                      <td className="money px-3 py-2 text-right">{formatINR(flat.price_paise)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border-strong bg-surface">
                    <td className="px-3 py-2 font-semibold text-navy-950">Total</td>
                    <td className="money px-3 py-2 text-right font-bold text-navy-950">
                      {formatINR(flat.price_breakup.length ? total : flat.price_paise)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {flat.price_breakup.length > 0 && total !== flat.price_paise && (
              <Notice tone="warning" className="mt-2">
                Breakup total differs from the stored price ({formatINR(flat.price_paise)}).
              </Notice>
            )}
            {canWrite && !booked && <PriceEditor flat={flat} invalidate={invalidate} />}
          </TabsContent>

          {(canStatus || canWrite) && (
            <TabsContent value="actions" className="space-y-5">
              {canStatus && !booked && <StatusChanger flat={flat} invalidate={invalidate} />}
              {canStatus && booked && (
                <Notice tone="info">
                  Booked and Sold flats are controlled by the booking engine; cancel the booking to release the flat.
                </Notice>
              )}
              {canWrite && <TypeChanger flat={flat} invalidate={invalidate} />}
            </TabsContent>
          )}

          <TabsContent value="history">
            {history.length === 0 ? (
              <p className="text-sm text-ink-subtle">No history yet.</p>
            ) : (
              <Timeline items={history} absolute />
            )}
          </TabsContent>
        </Tabs>
      </SheetBody>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface/60 px-3 py-2">
      <p className="label-caps">{label}</p>
      <p className="money text-sm font-semibold text-navy-950">{value}</p>
    </div>
  );
}

type Invalidate = ReadonlyArray<readonly unknown[]>;

function NotesEditor({
  flat,
  canWrite,
  invalidate,
}: {
  flat: FlatDetailResponse;
  canWrite: boolean;
  invalidate: Invalidate;
}) {
  const [notes, setNotes] = useState(flat.notes ?? "");
  useOnChange(`${flat.id}:${flat.version}`, () => setNotes(flat.notes ?? ""));
  const save = useMutationWithToast<FlatDetailResponse, string>({
    mutationFn: (value) =>
      api.patch<FlatDetailResponse>(
        `${FLATS_PATH}/${flat.id}`,
        { notes: value.trim() || null, version: flat.version },
        { version: flat.version },
      ),
    successMessage: "Notes saved",
    invalidate,
    entityLabel: "This flat",
  });
  if (!canWrite) {
    return (
      <section>
        <h4 className="label-caps mb-2">Notes</h4>
        <p className="whitespace-pre-wrap text-sm text-ink">
          {flat.notes || <span className="text-ink-subtle">—</span>}
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <FieldWrapper label="Notes">
        {(control) => (
          <Textarea
            id={control.id}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={1000}
            data-testid="flat-notes"
          />
        )}
      </FieldWrapper>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          leftIcon={Save}
          loading={save.isPending}
          disabled={notes === (flat.notes ?? "")}
          onClick={() => save.mutate(notes)}
        >
          Save notes
        </Button>
      </div>
    </section>
  );
}

function PriceEditor({ flat, invalidate }: { flat: FlatDetailResponse; invalidate: Invalidate }) {
  const [price, setPrice] = useState<number | null>(flat.price_paise);
  useOnChange(`${flat.id}:${flat.version}`, () => setPrice(flat.price_paise));
  const save = useMutationWithToast<FlatDetailResponse, number>({
    mutationFn: (value) =>
      api.patch<FlatDetailResponse>(
        `${FLATS_PATH}/${flat.id}`,
        { price_paise: value, version: flat.version },
        { version: flat.version },
      ),
    successMessage: "Price updated",
    invalidate,
    entityLabel: "This flat",
  });
  return (
    <div className="mt-4 space-y-2 rounded-md border border-border p-3">
      <FieldWrapper
        label="Set price"
        hint="Overrides the rate-card price for this flat; re-applying the rate card will re-price Available flats."
      >
        {(control) => <MoneyInput id={control.id} value={price} onChange={setPrice} data-testid="flat-price-input" />}
      </FieldWrapper>
      <div className="flex justify-end">
        <Button
          size="sm"
          leftIcon={IndianRupee}
          loading={save.isPending}
          disabled={price === null || price === flat.price_paise}
          onClick={() => price !== null && save.mutate(price)}
          data-testid="flat-price-save"
        >
          Update price
        </Button>
      </div>
    </div>
  );
}

function StatusChanger({ flat, invalidate }: { flat: FlatDetailResponse; invalidate: Invalidate }) {
  const [status, setStatus] = useState<ManualFlatStatus>(
    flat.status === "HOLD" || flat.status === "BLOCKED" ? flat.status : "AVAILABLE",
  );
  const [hours, setHours] = useState<number | null>(48);
  const [reason, setReason] = useState("");
  const change = useMutationWithToast<FlatDetailResponse, void>({
    mutationFn: () =>
      api.post<FlatDetailResponse>(
        `${FLATS_PATH}/${flat.id}/status`,
        {
          version: flat.version,
          status,
          reason: reason.trim() || null,
          hold_until: status === "HOLD" ? hoursFromNow(hours ?? 48) : null,
        },
        { version: flat.version },
      ),
    successMessage: () => `Flat ${flat.flat_number} is now ${FLAT_STATUS_LABELS[status].toLowerCase()}`,
    invalidate,
    entityLabel: "This flat",
    onSuccess: () => setReason(""),
  });
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h4 className="font-display text-sm font-bold text-navy-950">Change status</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldWrapper label="New status" required>
          {(control) => (
            <Select
              id={control.id}
              value={status}
              onValueChange={(value) => value && setStatus(value)}
              options={MANUAL_FLAT_STATUSES.map((value) => ({
                value,
                label: FLAT_STATUS_LABELS[value],
                disabled: value === flat.status,
              }))}
              data-testid="flat-status-select"
            />
          )}
        </FieldWrapper>
        {status === "HOLD" && (
          <FieldWrapper label="Hold for" required>
            {(control) => (
              <NumberInput
                id={control.id}
                value={hours}
                onChange={setHours}
                decimals={0}
                min={1}
                max={720}
                suffix="hours"
              />
            )}
          </FieldWrapper>
        )}
      </div>
      <FieldWrapper label="Reason">
        {(control) => (
          <Textarea
            id={control.id}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Recorded in the flat's history"
          />
        )}
      </FieldWrapper>
      <div className="flex justify-end">
        <Button
          size="sm"
          loading={change.isPending}
          disabled={status === flat.status}
          onClick={() => change.mutate()}
          data-testid="flat-status-save"
        >
          Apply status
        </Button>
      </div>
    </section>
  );
}

function TypeChanger({ flat, invalidate }: { flat: FlatDetailResponse; invalidate: Invalidate }) {
  const types = useMasterRows<FlatTypeRow>("flat-types");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const target = types.data?.find((type) => type.id === typeId) ?? null;
  const change = useMutationWithToast<FlatDetailResponse, string>({
    mutationFn: (flatTypeId) =>
      api.post<FlatDetailResponse>(
        `${FLATS_PATH}/${flat.id}/flat-type`,
        { version: flat.version, flat_type_id: flatTypeId, reprice: true },
        { version: flat.version },
      ),
    successMessage: (saved) => `Flat ${saved.flat_number} is now a ${saved.flat_type_code}`,
    invalidate,
    entityLabel: "This flat",
    onSuccess: () => setTypeId(null),
  });
  const allowed = flat.status === "AVAILABLE";
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h4 className="font-display text-sm font-bold text-navy-950">Change flat type</h4>
      {!allowed && (
        <Notice tone="warning">Only Available flats can change type (rooms and areas are re-snapshotted).</Notice>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <FieldWrapper label="New flat type" className="flex-1">
          {(control) => (
            <Select
              id={control.id}
              value={typeId}
              onValueChange={setTypeId}
              disabled={!allowed}
              options={(types.data ?? [])
                .filter((type) => type.id !== flat.flat_type_id)
                .map((type) => ({
                  value: type.id,
                  label: `${type.code} · ${type.name}`,
                  description: `${type.bhk} BHK · ${type.super_builtup_sqft ?? "?"} sq ft`,
                }))}
              placeholder={types.isPending ? "Loading…" : "Pick a flat type"}
              data-testid="flat-type-select"
            />
          )}
        </FieldWrapper>
        <Button
          variant="outline"
          leftIcon={ArrowRightLeft}
          disabled={!allowed || !typeId}
          onClick={() => setConfirm(true)}
          data-testid="flat-type-change"
        >
          Change type
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Change ${flat.flat_number} to ${target?.code ?? "new type"}?`}
        description="Rooms, areas and specifications are re-snapshotted from the new flat type and the price is recalculated from the active rate card."
        confirmLabel="Change type"
        onConfirm={async () => {
          if (typeId) await change.mutateAsync(typeId);
        }}
      />
    </section>
  );
}
