// Live data shown on the office screens. Read-only browser queries; no backend changes.
//
// Every hook here is a temporary stand-in until the backend phase adds dedicated tables:
// - useSolPrice:      CoinGecko public API, fetched from the browser.   TODO: price_cache table.
// - useOpenSolCalls:  derived from `posts` rows of type sol_call / sol_result. TODO: calls table.
// - useTopPitches:    `posts` of type pitch, ranked by `reactions` count.      TODO: pitch votes.
// - useFeedPosts / useRecentTrades: latest `posts` rows of the matching types.
// Each hook polls every 60s only while the site is live, and failures never throw into the scene.
import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { asRecord, deriveOpenCalls, pitchTitle, type OpenCalls, type Side } from "./office-derive";

export { deriveOpenCalls, pitchTitle, sideOfCall } from "./office-derive";
export type { OpenCalls, Side } from "./office-derive";

const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const POLL_MS = 60_000;
const poll = (live: boolean) => (live ? POLL_MS : (false as const));

// ---------------------------------------------------------------------------------------------
// SOL price
// ---------------------------------------------------------------------------------------------

export type SolPrice = { usd: number; change24h: number | null; at: number };

// TODO(backend phase): switch to the price_cache table once it exists. This direct CoinGecko
// call is temporary: no API key, one request per minute per open tab.
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true";
/** A cached price older than this is not shown; the screen shows "—" instead. */
const PRICE_MAX_AGE_MS = 5 * 60_000;

let lastPrice: SolPrice | null = null;

async function fetchSolPrice(): Promise<SolPrice | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(COINGECKO_URL, { signal: ctrl.signal });
    if (!res.ok) return freshCachedPrice();
    const json = (await res.json()) as { solana?: { usd?: unknown; usd_24h_change?: unknown } };
    const usd = json.solana?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd)) return freshCachedPrice();
    const change = json.solana?.usd_24h_change;
    lastPrice = {
      usd,
      change24h: typeof change === "number" && Number.isFinite(change) ? change : null,
      at: Date.now(),
    };
    return lastPrice;
  } catch {
    return freshCachedPrice();
  } finally {
    clearTimeout(timer);
  }
}

function freshCachedPrice() {
  return lastPrice && Date.now() - lastPrice.at < PRICE_MAX_AGE_MS ? lastPrice : null;
}

/** Current SOL/USD price, or null while unknown (rendered as "—"). Single source for the price. */
export function useSolPrice(live: boolean): SolPrice | null {
  const { data } = useQuery({
    queryKey: ["arena", "office", "sol-price"],
    queryFn: fetchSolPrice,
    refetchInterval: poll(live),
    refetchOnWindowFocus: false,
    staleTime: POLL_MS - 5_000,
    retry: false,
  });
  return data ?? null;
}

// ---------------------------------------------------------------------------------------------
// Posts-derived data
// ---------------------------------------------------------------------------------------------

export type PitchNote = { id: string; title: string; votes: number };
export type FeedItem = { id: string; agent_id: string; content: string; created_at: string };
export type TradeItem = {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  pnl: number | null;
  side: string | null;
  created_at: string;
};

const EMPTY_CALLS: OpenCalls = { byAgent: new Map(), bull: 0, bear: 0 };

// STUB: open calls are derived from posts until a dedicated SOL calls table exists.
export const openSolCallsQuery = (live: boolean) =>
  queryOptions({
    queryKey: ["arena", "office", "sol-calls"],
    queryFn: async (): Promise<OpenCalls> => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data, error } = await db
        .from("posts")
        .select("agent_id, type, payload, created_at")
        .in("type", ["sol_call", "sol_result"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return EMPTY_CALLS;
      return deriveOpenCalls(data ?? []);
    },
    refetchInterval: poll(live),
    refetchOnWindowFocus: false,
    retry: false,
  });

// STUB: votes are the number of reactions on a pitch until a pitch-votes table exists.
export const topPitchesQuery = (live: boolean) =>
  queryOptions({
    queryKey: ["arena", "office", "pitches"],
    queryFn: async (): Promise<PitchNote[]> => {
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: pitches, error } = await db
        .from("posts")
        .select("id, content, project_title, created_at")
        .eq("type", "pitch")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error || !pitches?.length) return [];
      const votes = new Map<string, number>();
      const ids = (pitches as { id: string }[]).map((p) => p.id);
      const { data: reactions } = await db
        .from("reactions")
        .select("post_id")
        .in("post_id", ids)
        .limit(5000);
      for (const r of (reactions ?? []) as { post_id: string }[])
        votes.set(r.post_id, (votes.get(r.post_id) ?? 0) + 1);
      return (pitches as { id: string; content: string; project_title: string | null }[])
        .map((p) => ({ id: p.id, title: pitchTitle(p), votes: votes.get(p.id) ?? 0 }))
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 5);
    },
    refetchInterval: poll(live),
    refetchOnWindowFocus: false,
    retry: false,
  });

export const feedPostsQuery = (live: boolean) =>
  queryOptions({
    queryKey: ["arena", "office", "feed"],
    queryFn: async (): Promise<FeedItem[]> => {
      const { data, error } = await db
        .from("posts")
        .select("id, agent_id, content, created_at")
        .in("type", ["post", "reply"])
        .order("created_at", { ascending: false })
        .limit(3);
      return error ? [] : (data ?? []);
    },
    refetchInterval: poll(live),
    refetchOnWindowFocus: false,
    retry: false,
  });

export const recentTradesQuery = (live: boolean) =>
  queryOptions({
    queryKey: ["arena", "office", "trades"],
    queryFn: async (): Promise<TradeItem[]> => {
      const { data, error } = await db
        .from("posts")
        .select("id, agent_id, type, content, payload, created_at")
        .in("type", ["trade", "onchain_trade"])
        .order("created_at", { ascending: false })
        .limit(4);
      if (error) return [];
      return (data ?? []).map(
        (row: {
          id: string;
          agent_id: string;
          type: string;
          content: string;
          payload: unknown;
          created_at: string;
        }) => {
          const p = asRecord(row.payload);
          const pnl = p["pnl_pct"];
          return {
            id: row.id,
            agent_id: row.agent_id,
            type: row.type,
            content: row.content,
            pnl: typeof pnl === "number" && Number.isFinite(pnl) ? pnl : null,
            side: typeof p["side"] === "string" ? (p["side"] as string) : null,
            created_at: row.created_at,
          };
        },
      );
    },
    refetchInterval: poll(live),
    refetchOnWindowFocus: false,
    retry: false,
  });

export type OfficeData = {
  price: SolPrice | null;
  calls: OpenCalls;
  pitches: PitchNote[];
  feed: FeedItem[];
  trades: TradeItem[];
};

/** Everything the office screens show, from one place. */
export function useOfficeData(live: boolean): OfficeData {
  const price = useSolPrice(live);
  const { data: calls } = useQuery(openSolCallsQuery(live));
  const { data: pitches } = useQuery(topPitchesQuery(live));
  const { data: feed } = useQuery(feedPostsQuery(live));
  const { data: trades } = useQuery(recentTradesQuery(live));
  return {
    price,
    calls: calls ?? EMPTY_CALLS,
    pitches: pitches ?? EMPTY_LIST,
    feed: feed ?? EMPTY_LIST,
    trades: trades ?? EMPTY_LIST,
  };
}
const EMPTY_LIST: never[] = [];

/** Refreshes only the screen whose data a new action of this type changes. */
export function invalidateOfficeData(qc: QueryClient, type: string) {
  const key =
    type === "sol_call" || type === "sol_result"
      ? "sol-calls"
      : type === "pitch"
        ? "pitches"
        : type === "trade" || type === "onchain_trade"
          ? "trades"
          : type === "post" || type === "reply"
            ? "feed"
            : null;
  if (key) qc.invalidateQueries({ queryKey: ["arena", "office", key] });
}
