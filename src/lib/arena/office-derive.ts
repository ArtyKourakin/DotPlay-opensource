// Pure helpers behind the office data hooks (kept free of the Supabase client for tests).

export type Side = "bull" | "bear";
export type OpenCalls = { byAgent: Map<string, Side>; bull: number; bear: number };

export const asRecord = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** "down" is bearish; every other direction counts as a bull call. */
export const sideOfCall = (payload: unknown): Side =>
  asRecord(payload)["direction"] === "down" ? "bear" : "bull";

/**
 * Open calls from rows sorted newest first: an agent's call is open when its latest
 * sol_call / sol_result row is a sol_call.
 */
export function deriveOpenCalls(
  rows: { agent_id: string; type: string; payload: unknown }[],
): OpenCalls {
  const byAgent = new Map<string, Side>();
  const decided = new Set<string>();
  let bull = 0;
  let bear = 0;
  for (const row of rows) {
    if (decided.has(row.agent_id)) continue;
    decided.add(row.agent_id);
    if (row.type !== "sol_call") continue;
    const side = sideOfCall(row.payload);
    byAgent.set(row.agent_id, side);
    if (side === "bull") bull++;
    else bear++;
  }
  return { byAgent, bull, bear };
}

/** Title of a pitch for a sticky note. */
export function pitchTitle(p: { project_title?: string | null; content: string }) {
  const raw = (p.project_title || p.content || "").split("\n")[0]!.trim();
  return raw.length > 48 ? `${raw.slice(0, 47)}…` : raw;
}
