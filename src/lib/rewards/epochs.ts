// Daily reward epochs: window arithmetic and the lifecycle state machine.
// Pure module. The same transition table is enforced in the database by the
// reward_epochs_transition_guard trigger.

export const EPOCH_STATES = [
  "open",
  "calculating",
  "review",
  "approved",
  "paying",
  "paid",
  "failed",
  "cancelled",
] as const;
export type EpochState = (typeof EPOCH_STATES)[number];

export const EPOCH_TRANSITIONS: Record<EpochState, readonly EpochState[]> = {
  open: ["calculating", "cancelled"],
  calculating: ["review", "failed"],
  review: ["calculating", "approved", "cancelled"],
  approved: ["paying", "cancelled"],
  paying: ["paid", "failed", "approved"],
  paid: [],
  failed: ["calculating", "paying", "cancelled"],
  cancelled: [],
};

export function canTransition(from: EpochState, to: EpochState): boolean {
  return EPOCH_TRANSITIONS[from]?.includes(to) ?? false;
}

/** States whose allocations are final and therefore payable or paid. */
export const FINALIZED_EPOCH_STATES: readonly EpochState[] = ["approved", "paying", "paid"];
/** States in which Karma of the epoch may still be (re)computed. */
export const KARMA_MUTABLE_STATES: readonly EpochState[] = ["open", "calculating", "failed"];

export type EpochWindow = { epoch_key: string; starts_at: string; ends_at: string };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function keyFor(startMs: number): string {
  // e.g. "2026-09-26T00Z": unique even when the epoch hour is changed later.
  return `${new Date(startMs).toISOString().slice(0, 13)}Z`;
}

/** The epoch window that contains `atMs`, for an epoch that starts every day at `hourUtc`. */
export function epochWindowContaining(atMs: number, hourUtc: number): EpochWindow {
  const d = new Date(atMs);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc);
  if (start > atMs) start -= DAY_MS;
  return {
    epoch_key: keyFor(start),
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + DAY_MS).toISOString(),
  };
}

/**
 * The epoch that follows `previous`. Epochs are contiguous: the next one always
 * starts where the previous one ended, so no activity falls in a gap even if the
 * epoch hour is changed. It ends at the next daily boundary at least one hour
 * later.
 */
export function nextEpochWindow(previousEndsAt: string, hourUtc: number): EpochWindow {
  const start = Date.parse(previousEndsAt);
  let end = Date.parse(epochWindowContaining(start, hourUtc).ends_at);
  if (end - start < HOUR_MS) end += DAY_MS;
  return {
    epoch_key: keyFor(start),
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
  };
}

/**
 * The windows that must exist so that an epoch covers `nowMs`, following the
 * latest existing epoch. Bounded so one run never creates an unbounded backlog.
 */
export function missingEpochWindows(
  latestEndsAt: string | null,
  nowMs: number,
  hourUtc: number,
  maxWindows = 31,
): EpochWindow[] {
  if (!latestEndsAt) return [epochWindowContaining(nowMs, hourUtc)];
  const out: EpochWindow[] = [];
  let endsAt = latestEndsAt;
  while (Date.parse(endsAt) <= nowMs && out.length < maxWindows) {
    const next = nextEpochWindow(endsAt, hourUtc);
    out.push(next);
    endsAt = next.ends_at;
  }
  return out;
}

/** An open epoch may be finalized once it has ended and the review delay has passed. */
export function isDueForCalculation(
  endsAt: string,
  finalizationDelayHours: number,
  nowMs: number,
): boolean {
  return Date.parse(endsAt) + finalizationDelayHours * HOUR_MS <= nowMs;
}

export function nextDistributionAt(endsAt: string, finalizationDelayHours: number): string {
  return new Date(Date.parse(endsAt) + finalizationDelayHours * HOUR_MS).toISOString();
}
