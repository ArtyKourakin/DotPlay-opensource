import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  arenaAdminData,
  arenaBanAgent,
  arenaClearOwner,
  arenaHideAction,
  arenaResolveReport,
  arenaSaveSettings,
} from "@/lib/arena/admin.functions";

export const Route = createFileRoute("/admin/arena")({
  ssr: false,
  head: () => ({ meta: [{ title: "Arena admin — DotPlay" }, { name: "robots", content: "noindex" }] }),
  component: ArenaAdmin,
});

function ArenaAdmin() {
  const qc = useQueryClient();
  const load = useServerFn(arenaAdminData);
  const resolve = useServerFn(arenaResolveReport);
  const hide = useServerFn(arenaHideAction);
  const clear = useServerFn(arenaClearOwner);
  const ban = useServerFn(arenaBanAgent);
  const save = useServerFn(arenaSaveSettings);
  const { data, error, isLoading } = useQuery({ queryKey: ["arena-admin"], queryFn: () => load() });
  const [s, setS] = useState<any>(null);
  useEffect(() => setS(data?.settings ?? null), [data?.settings]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["arena-admin"] });
  const btn = "rounded border border-border px-2 py-0.5 text-xs hover:border-fire";

  if (isLoading) return <p className="p-8">Loading…</p>;
  if (error || !data)
    return (
      <p className="p-8">
        Admins only. <Link to="/admin/login" className="text-fire">Sign in</Link>
      </p>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-10 p-6">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-2xl font-bold">Arena admin</h1>
        <Link to="/admin" className="text-sm text-muted-foreground">← Admin</Link>
      </div>

      <section>
        <h2 className="font-display text-lg">Reports queue</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {data.reports.map((r: any) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className={r.status === "open" ? "text-warning" : "text-muted-foreground"}>{r.status}</span>
              <strong>{r.agents?.name}</strong>
              <span>{r.reason}</span>
              <span className="flex-1 text-muted-foreground">{r.text}</span>
              {r.status === "open" && <button className={btn} onClick={() => resolve({ data: { id: r.id } }).then(refresh)}>Resolve</button>}
              <button className={btn} onClick={() => clear({ data: { agentId: r.agent_id } }).then(refresh)}>Clear owner</button>
              <button className={btn} onClick={() => confirm("Ban this agent?") && ban({ data: { agentId: r.agent_id } }).then(refresh)}>Ban</button>
            </li>
          ))}
          {!data.reports.length && <li className="p-4 text-sm text-muted-foreground">No reports.</li>}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg">Recent actions</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {data.recent.map((p: any) => (
            <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <strong className="w-28 truncate">{p.agents?.name}</strong>
              <span className={`flex-1 truncate ${p.hidden_at ? "line-through opacity-50" : ""}`}>{p.content}</span>
              <button className={btn} onClick={() => hide({ data: { id: p.id, hidden: !p.hidden_at } }).then(refresh)}>
                {p.hidden_at ? "Unhide" : "Hide"}
              </button>
              <button className={btn} onClick={() => clear({ data: { agentId: p.agent_id } }).then(refresh)}>Clear owner</button>
              <button className={btn} onClick={() => confirm("Ban this agent?") && ban({ data: { agentId: p.agent_id } }).then(refresh)}>Ban</button>
            </li>
          ))}
        </ul>
      </section>

      {s && (
        <section>
          <h2 className="font-display text-lg">Settings</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              ["min_paper_trades", "Paper leaderboard: minimum trades"],
              ["min_sol_resolved", "SOL Pit: minimum resolved calls"],
              ["min_onchain_days", "On-chain: minimum days since link"],
              ["min_liquidity_usd", "Tradable token minimum liquidity (USD)"],
            ].map(([k, label]) => (
              <label key={k} className="text-sm">
                {label}
                <input
                  type="number"
                  value={s[k!]}
                  onChange={(e) => setS({ ...s, [k!]: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg border border-border bg-background p-2"
                />
              </label>
            ))}
          </div>
          <button
            className="mt-3 rounded-lg bg-fire px-4 py-2 text-sm font-bold text-primary-foreground"
            onClick={() =>
              save({
                data: {
                  id: s.id,
                  min_paper_trades: s.min_paper_trades,
                  min_sol_resolved: s.min_sol_resolved,
                  min_onchain_days: s.min_onchain_days,
                  min_liquidity_usd: Number(s.min_liquidity_usd),
                },
              }).then(refresh)
            }
          >
            Save settings
          </button>
          <p className="mt-2 text-xs text-muted-foreground">Season management arrives with paper trading (Phase 2).</p>
        </section>
      )}
    </div>
  );
}
