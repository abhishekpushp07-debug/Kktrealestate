/**
 * Flat holds (SPEC §4, §12): a HOLD carries `hold_until`; once that instant has passed the hold is lapsed and the flat behaves as
 * AVAILABLE everywhere (booking engine, availability grids, reserve) until the HOLD_EXPIRY job writes the release.
 */
import { toEpochMs } from "./ist.js";

/** Minimum and maximum minutes the booking wizard may reserve a flat for (POST /flats/:id/reserve). */
export const RESERVE_MIN_MINUTES = 1;
export const RESERVE_MAX_MINUTES = 30;

/** True when a HOLD's `hold_until` lies at or before `now` (a HOLD without hold_until never lapses on its own). */
export function isHoldExpired(flat: { status: string; holdUntil: Date | string | null | undefined }, now: Date | string | number = Date.now()): boolean {
  if (flat.status !== "HOLD" || flat.holdUntil === null || flat.holdUntil === undefined) {
    return false;
  }
  return toEpochMs(flat.holdUntil) <= toEpochMs(now);
}

/** The status a flat effectively has at `now`: a lapsed HOLD reads as AVAILABLE, every other status as stored. */
export function effectiveFlatStatus<S extends string>(flat: { status: S; holdUntil: Date | string | null | undefined }, now: Date | string | number = Date.now()): S | "AVAILABLE" {
  return isHoldExpired(flat, now) ? "AVAILABLE" : flat.status;
}

/** hold_until of a reservation of `minutes` starting at `now`; throws RangeError outside 1–30 whole minutes. */
export function reserveUntil(minutes: number, now: Date | string | number = Date.now()): Date {
  if (!Number.isInteger(minutes) || minutes < RESERVE_MIN_MINUTES || minutes > RESERVE_MAX_MINUTES) {
    throw new RangeError(`Reservation must be ${RESERVE_MIN_MINUTES}–${RESERVE_MAX_MINUTES} whole minutes, got ${minutes}`);
  }
  return new Date(toEpochMs(now) + minutes * 60_000);
}
