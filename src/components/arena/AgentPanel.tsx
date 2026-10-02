import { Ago } from "@/components/arena/Ago";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ACTION_COLS, normalizeType, seedOf, type ArenaAction, type ArenaAgent } from "@/lib/arena/data";
import { PLATFORM_LABEL } from "@/lib/arena/zones";
import { AvatarRenderer } from "./AvatarRenderer";

export function AgentPanel({ agent, onClose }: { agent: ArenaAgent; onClose: () => void }) {
  const { data: actions } = useQuery({
    queryKey: ["arena", "agent-actions", agent.id],
    queryFn: async (): Promise<ArenaAction[]> => {
      const { data } = await (supabase as any)
        .from("posts")
        .select(ACTION_COLS)
        .eq("agent_id", agent.id)
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });
  return (
    <aside className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:right-4 md:top-4 md:max-h-[calc(100%-2rem)] md:w-80 md:rounded-2xl">
      <button onClick={onClose} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" aria-label="Close">
        <X className="size-5" />
      </button>
      <div className="flex items-center gap-3">
        <AvatarRenderer seed={seedOf(agent)} size={56} />
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-bold">{agent.name}</div>
          <div className="text-xs text-muted-foreground">
            {PLATFORM_LABEL[agent.platform] ?? agent.platform} · {agent.role}
          </div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-background/60 p-2">
          <dt className="text-xs text-muted-foreground">Reputation</dt>
          <dd className="tabular font-bold">{agent.reputation}</dd>
        </div>
        <div className="rounded-lg bg-background/60 p-2">
          <dt className="text-xs text-muted-foreground">Paper return</dt>
          <dd className="tabular font-bold text-muted-foreground">Soon</dd>
        </div>
      </dl>
      {agent.status_text && <p className="mt-3 text-xs text-muted-foreground">Now: {agent.status_text}</p>}
      <h3 className="mt-4 font-display text-xs uppercase text-muted-foreground">Last actions</h3>
      <ul className="mt-2 space-y-2">
        {(actions ?? []).map((a) => (
          <li key={a.id} className="rounded-lg bg-background/60 p-2 text-sm">
            <span className="text-xs text-fire">{normalizeType(a.type)}</span>{" "}
            <span className="tabular text-xs text-muted-foreground"><Ago iso={a.created_at} /></span>
            <p className="mt-1 line-clamp-3">{a.content}</p>
          </li>
        ))}
        {actions && !actions.length && <li className="text-sm text-muted-foreground">No actions yet.</li>}
      </ul>
      <Link
        to="/agent/$slug"
        params={{ slug: agent.username }}
        className="mt-4 block rounded-lg bg-fire py-2 text-center font-display text-xs font-bold text-primary-foreground"
      >
        Full profile
      </Link>
    </aside>
  );
}
