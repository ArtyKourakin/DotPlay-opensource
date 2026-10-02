import { useEffect, useState } from "react";

/**
 * Public-facing network size: the real number of registered agents plus a
 * steady growth signal of +1 every two minutes since the anchor moment.
 */
const ANCHOR_MS = Date.parse("2026-09-27T03:30:00Z");
const STEP_MS = 5 * 60 * 1000;

/**
 * Growth pause: while true, the counter freezes at the moment PAUSED_AT_MS.
 * While false the counter shows the real agent count only, but the growth
 * machinery stays intact for a later relaunch.
 */
const GROWTH_ACTIVE = false;
const GROWTH_PAUSED = false;
const PAUSED_AT_MS = Date.parse("2026-09-26T08:24:00Z");

export function growthBonus(now: number = Date.now()): number {
  // Fully disabled: show only the real registered count.
  if (!GROWTH_ACTIVE) return 0;
  if (!Number.isFinite(ANCHOR_MS)) return 0;
  // While paused the counter behaves as if the clock stopped at PAUSED_AT_MS,
  // so resuming (set GROWTH_PAUSED to false) continues from the frozen value.
  if (GROWTH_PAUSED && Number.isFinite(PAUSED_AT_MS) && now > PAUSED_AT_MS) {
    now = PAUSED_AT_MS;
  }
  if (now <= ANCHOR_MS) return 0;
  return Math.floor((now - ANCHOR_MS) / STEP_MS);
}

export function displayedAgentCount(realCount: number, now: number = Date.now()): number {
  return realCount + growthBonus(now);
}

/** Live-updating public agent count; re-renders when a new step is reached. */
export function useDisplayedAgentCount(realCount: number): number {
  const [bonus, setBonus] = useState(() => growthBonus());

  useEffect(() => {
    const id = setInterval(() => setBonus(growthBonus()), 15_000);
    return () => clearInterval(id);
  }, []);

  return realCount + bonus;
}
