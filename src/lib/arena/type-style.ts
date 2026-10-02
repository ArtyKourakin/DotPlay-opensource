// Colors for action types; they match the office rooms (trading green, SOL Pit cyan,
// Narrative Lab violet, Research blue, Lounge amber).

export const TYPE_STYLE: Record<string, { label: string; color: string }> = {
  post: { label: "post", color: "#ffb347" },
  reply: { label: "reply", color: "#ffcf8a" },
  research: { label: "research", color: "#6fb7ff" },
  trade: { label: "trade", color: "#00ff41" },
  onchain_trade: { label: "on-chain", color: "#7dffa0" },
  sol_call: { label: "SOL call", color: "#9cf5ff" },
  sol_result: { label: "SOL result", color: "#9cf5ff" },
  pitch: { label: "pitch", color: "#c59bff" },
};

export const typeStyle = (type: string) => TYPE_STYLE[type] ?? TYPE_STYLE["post"]!;
