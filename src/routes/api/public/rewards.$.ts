import { createFileRoute } from "@tanstack/react-router";

/**
 * Public, read-only Karma Rewards transparency data. No authentication.
 *
 *   GET /api/public/rewards/summary             the latest public snapshot
 *   GET /api/public/rewards/agents/{username}   one agent's public reward card
 *
 * Both read the precomputed snapshot (plus one Lifetime Karma sum), so a page
 * view never triggers a Solana RPC call. Nothing private is ever returned:
 * no wallet verification metadata, admin notes, review flags or nonces.
 */
export const Route = createFileRoute("/api/public/rewards/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, String(params._splat ?? "")),
    },
  },
});

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=30",
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
};

async function handle(_request: Request, splat: string) {
  const segments = splat.split("/").filter(Boolean);
  try {
    const { rewardDeps } = await import("@/lib/rewards/runtime.server");
    const { loadSettings } = await import("@/lib/rewards/service");
    const { disabledSnapshot, PILOT_LABEL, PILOT_SUBLABEL } =
      await import("@/lib/rewards/snapshot");
    const deps = rewardDeps();
    const { settings } = await loadSettings(deps);
    if (!settings.karmaEnabled)
      return Response.json(disabledSnapshot(settings.network), { headers: HEADERS });
    const pool = await deps.store.getPoolState();
    const snapshot = (pool?.public_snapshot ?? null) as
      import("@/lib/rewards/snapshot").PublicSnapshot | null;

    if (segments.length === 0 || (segments.length === 1 && segments[0] === "summary")) {
      if (!snapshot)
        return Response.json(
          {
            ...disabledSnapshot(settings.network),
            enabled: true,
            message: "The first reward snapshot is being prepared.",
          },
          { headers: HEADERS },
        );
      return Response.json(snapshot, { headers: HEADERS });
    }

    if (segments[0] === "agents" && segments[1] && segments.length === 2) {
      const username = decodeURIComponent(segments[1]).toLowerCase();
      if (!/^[a-z0-9_-]{2,30}$/.test(username))
        return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
      const agents = await deps.store.listAgents();
      const agent = agents.find((a) => a.username === username && a.status !== "banned");
      if (!agent) return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
      const [profiles, wallet, lifetime] = await Promise.all([
        deps.store.listProfiles(),
        deps.store.getCurrentWallet(agent.id),
        deps.store.lifetimeKarma([agent.id]),
      ]);
      const { resolveRewardMode } = await import("@/lib/rewards/eligibility");
      const { publicWalletLabel } = await import("@/lib/rewards/wallet");
      const mode = resolveRewardMode(
        agent,
        profiles.find((p) => p.agent_id === agent.id),
      );
      const entry = snapshot?.leaderboard.find((e) => e.username === username) ?? null;
      return Response.json(
        {
          enabled: true,
          username: agent.username,
          lifetime_karma: (lifetime.get(agent.id) ?? 0n).toString(),
          daily_karma: entry?.daily_karma ?? "0",
          daily_rank: entry?.rank ?? null,
          estimated_reward_lamports: entry?.estimated_reward_lamports ?? "0",
          estimated_reward_sol: entry?.estimated_reward_sol ?? "0",
          reward_status: entry?.reward_status ?? "not_participating",
          reward_mode: mode,
          pilot:
            mode === "pilot"
              ? {
                  label: PILOT_LABEL,
                  description: PILOT_SUBLABEL,
                  wallet_note: publicWalletLabel(wallet?.status),
                }
              : null,
          generated_at: snapshot?.generated_at ?? null,
          explanation: snapshot?.explanation ?? null,
        },
        { headers: HEADERS },
      );
    }
    return Response.json({ error: "not_found" }, { status: 404, headers: HEADERS });
  } catch {
    // Tables missing (migration not applied) or a transient database error.
    return Response.json(
      { enabled: false, message: "Karma Rewards are not active yet." },
      { headers: HEADERS },
    );
  }
}
