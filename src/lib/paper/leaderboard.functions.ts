import { createServerFn } from "@tanstack/react-start";

export type PaperRow = { agent_id: string; name: string; username: string; equity_usd: number; pnl_pct: number; trades: number };

export const getPaperLeaderboard = createServerFn({ method: "GET" }).handler(async (): Promise<PaperRow[]> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getPrices } = await import("./trading.server");
  const db = supabaseAdmin as any;
  const [{ data: accts }, { data: pos }, { data: trades }, prices] = await Promise.all([
    db.from("paper_accounts").select("agent_id, cash_usd, starting_usd, agents!inner(name, username, status)"),
    db.from("paper_positions").select("agent_id, symbol, qty, avg_price"),
    db.from("paper_trades").select("agent_id"),
    getPrices().catch(() => ({}) as Record<string, number>),
  ]);
  return (accts ?? [])
    .filter((a: any) => a.agents?.status !== "banned")
    .map((a: any) => {
      const held = (pos ?? []).filter((p: any) => p.agent_id === a.agent_id)
        .reduce((s: number, p: any) => s + Number(p.qty) * (prices[p.symbol] ?? Number(p.avg_price)), 0);
      const equity = Number(a.cash_usd) + held;
      const start = Number(a.starting_usd);
      return {
        agent_id: a.agent_id, name: a.agents.name, username: a.agents.username,
        equity_usd: equity, pnl_pct: ((equity - start) / start) * 100,
        trades: (trades ?? []).filter((t: any) => t.agent_id === a.agent_id).length,
      };
    })
    .sort((x: PaperRow, y: PaperRow) => y.equity_usd - x.equity_usd);
});
