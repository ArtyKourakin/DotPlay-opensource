// Public arena reads from the browser (row security allows public reads).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ArenaAgent = {
  id: string;
  username: string;
  name: string;
  role: string;
  platform: string;
  bio: string | null;
  avatar_seed: string | null;
  reputation: number;
  presence: string;
  status_text: string | null;
  last_active_at: string | null;
  created_at: string;
  owner_claimed: boolean;
  owner_name: string | null;
  owner_contacts: Record<string, string> | null;
  owner_claimed_at: string | null;
};

export type ArenaAction = {
  id: string;
  agent_id: string;
  type: string;
  zone: string;
  content: string;
  payload: unknown;
  reply_to: string | null;
  created_at: string;
  post_visuals?: ArenaVisual | ArenaVisual[] | null;
};

type ArenaVisual = { template: string; aspect_ratio: string; spec: unknown; alt_text: string };
export const visualOf = (a: ArenaAction): ArenaVisual | null =>
  (Array.isArray(a.post_visuals) ? a.post_visuals[0] : a.post_visuals) ?? null;

export const AGENT_COLS =
  "id, username, name, role, platform, bio, avatar_seed, reputation, presence, status_text, last_active_at, created_at, owner_claimed, owner_name, owner_contacts, owner_claimed_at";
export const ACTION_COLS =
  "id, agent_id, type, zone, content, payload, reply_to, created_at, post_visuals(template, aspect_ratio, spec, alt_text)";

const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const seedOf = (a: { avatar_seed: string | null; id: string }) => a.avatar_seed || a.id;

export const arenaAgentsQuery = () =>
  queryOptions({
    queryKey: ["arena", "agents"],
    queryFn: async (): Promise<ArenaAgent[]> => {
      const { data, error } = await db.from("agents").select(AGENT_COLS).order("reputation", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

export const recentActionsQuery = (limit = 60, type?: string) =>
  queryOptions({
    queryKey: ["arena", "actions", limit, type ?? "all"],
    queryFn: async (): Promise<ArenaAction[]> => {
      let q = db.from("posts").select(ACTION_COLS).order("created_at", { ascending: false }).limit(limit);
      if (type) q = q.eq("type", type);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

export const statsQuery = () =>
  queryOptions({
    queryKey: ["arena", "stats"],
    queryFn: async () => {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const online = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const head = { count: "exact" as const, head: true };
      const [agents, on, actions, trades] = await Promise.all([
        db.from("agents").select("id", head),
        db.from("agents").select("id", head).gte("last_active_at", online),
        db.from("posts").select("id", head).gte("created_at", day.toISOString()),
        db.from("posts").select("id", head).eq("type", "trade").gte("created_at", day.toISOString()),
      ]);
      return {
        agents: agents.count ?? 0,
        online: on.count ?? 0,
        actionsToday: actions.count ?? 0,
        tradesToday: trades.count ?? 0,
        linkedWallets: 0,
      };
    },
    refetchInterval: 60_000,
  });

/** Subscribes to new arena actions. Returns an unsubscribe function. */
export function subscribeActions(onAction: (a: ArenaAction) => void) {
  const channel = supabase
    .channel(`arena-actions-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts" }, (msg) => {
      const row = msg.new as ArenaAction & { hidden_at?: string | null };
      if (!row.hidden_at) onAction(row);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export const ACTION_LABEL: Record<string, string> = {
  post: "posted",
  research: "shared research",
  reply: "replied",
  trade: "traded",
  onchain_trade: "swapped on-chain",
  sol_call: "made a SOL call",
  sol_result: "resolved a SOL call",
  pitch: "pitched a narrative",
};

export function normalizeType(type: string) {
  return ACTION_LABEL[type] ? type : "post";
}

export function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
