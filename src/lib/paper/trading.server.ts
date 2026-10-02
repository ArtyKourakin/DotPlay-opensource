// Paper trading: every agent starts with $10,000 of play money and trades on real prices.
// SERVER ONLY.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PAPER_SYMBOLS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  SUI: "sui",
};

let cache: { at: number; prices: Record<string, number> } | null = null;

export async function getPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.prices;
  const ids = Object.values(PAPER_SYMBOLS).join(",");
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
  if (!res.ok) throw new Error(`price_feed_${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number }>;
  const prices: Record<string, number> = {};
  for (const [sym, id] of Object.entries(PAPER_SYMBOLS)) {
    const p = body[id]?.usd;
    if (typeof p === "number" && p > 0) prices[sym] = p;
  }
  cache = { at: Date.now(), prices };
  return prices;
}

const db = supabaseAdmin as any;

export async function getPaperAccount(agentId: string) {
  await db.from("paper_accounts").upsert({ agent_id: agentId }, { onConflict: "agent_id", ignoreDuplicates: true });
  const [{ data: acct }, { data: positions }, prices] = await Promise.all([
    db.from("paper_accounts").select("cash_usd, starting_usd").eq("agent_id", agentId).single(),
    db.from("paper_positions").select("symbol, qty, avg_price").eq("agent_id", agentId),
    getPrices().catch(() => ({}) as Record<string, number>),
  ]);
  const pos = (positions ?? []).map((p: any) => {
    const price = prices[p.symbol] ?? Number(p.avg_price);
    return { symbol: p.symbol, qty: Number(p.qty), avg_price: Number(p.avg_price), price, value_usd: Number(p.qty) * price };
  });
  const cash = Number(acct?.cash_usd ?? 10000);
  const equity = cash + pos.reduce((s: number, p: any) => s + p.value_usd, 0);
  const start = Number(acct?.starting_usd ?? 10000);
  return { cash_usd: cash, equity_usd: equity, pnl_pct: ((equity - start) / start) * 100, positions: pos, prices };
}

export type TradeInput = { symbol: string; side: "buy" | "sell"; usd: number; note?: string | undefined };

export async function executePaperTrade(agentId: string, input: TradeInput) {
  const symbol = String(input.symbol || "").toUpperCase();
  if (!PAPER_SYMBOLS[symbol]) return { ok: false as const, error: "unknown_symbol", message: `Supported: ${Object.keys(PAPER_SYMBOLS).join(", ")}` };
  if (input.side !== "buy" && input.side !== "sell") return { ok: false as const, error: "invalid_side", message: "side must be buy or sell" };
  const usd = Number(input.usd);
  if (!Number.isFinite(usd) || usd < 10 || usd > 100000) return { ok: false as const, error: "invalid_amount", message: "usd must be between 10 and 100000" };
  const prices = await getPrices();
  const price = prices[symbol];
  if (!price) return { ok: false as const, error: "price_unavailable", message: "Price feed unavailable, try later." };
  const { data, error } = await db.rpc("paper_execute_trade", {
    p_agent_id: agentId, p_symbol: symbol, p_side: input.side, p_usd: usd, p_price: price, p_note: input.note ?? null,
  });
  if (error) {
    const code = /insufficient_cash|no_position|invalid_amount/.exec(error.message)?.[0] ?? "trade_failed";
    return { ok: false as const, error: code, message: code.replace(/_/g, " ") };
  }
  return { ok: true as const, trade_id: data as string, symbol, side: input.side, price, usd };
}

/** Lets one of the platform's DeepSeek agents decide on a paper trade. */
export async function runAgentPaperTrade(agent: { id: string; name: string; bio?: string | null }) {
  const apiKey = (process.env["DEEPSEEK_API_KEY"] || process.env["Deepseek_API"])?.trim();
  const model = (process.env["DEEPSEEK_MODEL"] || "").trim();
  if (!apiKey || !model) return { status: "skipped", code: "deepseek_not_configured" };
  const account = await getPaperAccount(agent.id);
  const base = (process.env["DEEPSEEK_BASE_URL"] || "https://api.deepseek.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        { role: "system", content: `You are ${agent.name}, an AI agent on DotPlay. ${agent.bio ?? ""} You manage a paper trading portfolio (play money). Reply only JSON: {"action":"buy"|"sell"|"hold","symbol":"BTC","usd":250,"note":"short English reason"}. You were woken up to trade: make one buy or sell now, choose hold only if you truly have no view. Keep risk moderate: one trade at most 15% of equity, usd at least 50.` },
        { role: "user", content: JSON.stringify({ cash_usd: Math.round(account.cash_usd), equity_usd: Math.round(account.equity_usd), positions: account.positions.map((p: any) => ({ symbol: p.symbol, value_usd: Math.round(p.value_usd), avg_price: p.avg_price })), prices: account.prices }) },
      ],
    }),
  });
  if (!res.ok) return { status: "failed", code: `deepseek_${res.status}` };
  const body = (await res.json()) as any;
  let decision: any;
  try { decision = JSON.parse(body?.choices?.[0]?.message?.content ?? "{}"); } catch { return { status: "failed", code: "bad_json" }; }
  if (decision.action !== "buy" && decision.action !== "sell") return { status: "skipped", code: "hold" };
  const usd = Math.min(Number(decision.usd) || 0, account.equity_usd * 0.15);
  const result = await executePaperTrade(agent.id, { symbol: decision.symbol, side: decision.action, usd, note: decision.note });
  return result.ok ? { status: "completed", code: "paper_trade", ...result } : { status: "skipped", code: result.error };
}
