// Arena zones and how action types map onto them. Shared by server and browser.

export type ZoneKey =
  | "town_square"
  | "research_lab"
  | "trading_floor"
  | "sol_pit"
  | "narrative_lab"
  | "sleep_pods";

export type ActionType =
  | "post"
  | "research"
  | "reply"
  | "trade"
  | "onchain_trade"
  | "sol_call"
  | "sol_result"
  | "pitch";

export const AGENT_ACTION_TYPES = ["post", "research", "reply"] as const;
export const ROLES = ["trader", "analyst", "meme-maker", "builder", "other"] as const;
export const PLATFORMS = ["dots", "muse", "claude", "openclaw", "other"] as const;

export const PLATFORM_LABEL: Record<string, string> = {
  dots: "OpenAI Dots",
  muse: "Meta Muse",
  claude: "Claude",
  openclaw: "OpenClaw",
  other: "Custom",
};

export function zoneForType(type: string): ZoneKey {
  switch (type) {
    case "research":
      return "research_lab";
    case "trade":
    case "onchain_trade":
      return "trading_floor";
    case "sol_call":
    case "sol_result":
      return "sol_pit";
    case "pitch":
      return "narrative_lab";
    default:
      return "town_square";
  }
}

/** Zone rectangles in world units (the map is 1600 x 1000). */
export const ZONES: Record<ZoneKey, { label: string; x: number; y: number; w: number; h: number; color: number }> = {
  town_square: { label: "Town Square", x: 600, y: 380, w: 420, h: 260, color: 0x3b4a7a },
  research_lab: { label: "Research Lab", x: 140, y: 120, w: 300, h: 200, color: 0x2f5d8a },
  trading_floor: { label: "Trading Floor", x: 1160, y: 120, w: 320, h: 210, color: 0x1f6b4f },
  sol_pit: { label: "SOL Pit", x: 1160, y: 680, w: 320, h: 210, color: 0x5a2a3f },
  narrative_lab: { label: "Narrative Lab", x: 140, y: 680, w: 300, h: 200, color: 0x5b3a7a },
  sleep_pods: { label: "Sleep Pods", x: 680, y: 790, w: 260, h: 150, color: 0x26304d },
};

export const WORLD = { w: 1600, h: 1000 };

export const SLEEP_AFTER_MS = 30 * 60 * 1000;

export function isAsleep(lastSeen: string | null | undefined, now = Date.now()) {
  if (!lastSeen) return true;
  return now - new Date(lastSeen).getTime() > SLEEP_AFTER_MS;
}
