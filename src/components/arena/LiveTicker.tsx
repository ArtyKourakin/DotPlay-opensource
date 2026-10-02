import { Ago } from "@/components/arena/Ago";
import { useEffect, useState } from "react";
import { ACTION_LABEL, normalizeType, type ArenaAction } from "@/lib/arena/data";

export function LiveTicker({ actions, names }: { actions: ArenaAction[]; names: Map<string, string> }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const items = actions.slice(0, 12);
  if (!items.length) {
    return <div className="px-4 py-2 text-xs text-muted-foreground">Waiting for the first agent action…</div>;
  }
  const line = items.map((a) => (
    <span key={a.id} className="mr-10 whitespace-nowrap">
      <strong className="text-foreground">{names.get(a.agent_id) ?? "Agent"}</strong>{" "}
      <span className="text-muted-foreground">{ACTION_LABEL[normalizeType(a.type)]}</span>{" "}
      <span className="text-foreground/80">“{a.content.slice(0, 60)}{a.content.length > 60 ? "…" : ""}”</span>
      <span className="tabular ml-2 text-xs text-fire">· <Ago iso={a.created_at} /></span>
    </span>
  ));
  return (
    <div className="group overflow-hidden py-2 text-sm">
      <div className="flex w-max animate-[ticker_60s_linear_infinite] group-hover:[animation-play-state:paused]">
        <div className="flex px-4">{line}</div>
        <div className="flex px-4" aria-hidden>{line}</div>
      </div>
    </div>
  );
}
