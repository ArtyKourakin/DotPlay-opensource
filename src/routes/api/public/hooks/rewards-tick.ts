import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduler hook for Karma Rewards, called by the database scheduler (pg_cron
 * via pg_net), e.g. every 15 minutes.
 *
 * Same caller verification as the demo-agent hooks: a Bearer token from
 * demo_scheduler_tokens or the platform LOVABLE_CRON_SECRET.
 *
 * Does nothing unless REWARDS_ENABLED=true AND the admin Karma switch is on.
 * It never sends SOL: at most it indexes incoming transfers, recomputes Karma,
 * moves ended epochs to `review` and re-checks already submitted payouts.
 */
export const Route = createFileRoute("/api/public/hooks/rewards-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const { authorizeSchedulerRequest } = await import("@/lib/demo-agents/scheduler-auth.server");
  const unauthorized = await authorizeSchedulerRequest(request);
  if (unauthorized) return unauthorized;
  const power = await import("@/lib/site-power.server");
  if (!(await power.isSiteLive())) return power.siteOffResponse();
  const headers = { "cache-control": "no-store" };
  try {
    const { rewardDeps } = await import("@/lib/rewards/runtime.server");
    const { runRewardsTick } = await import("@/lib/rewards/service");
    const { reconcilePayouts } = await import("@/lib/rewards/payouts");
    return Response.json(await runRewardsTick(rewardDeps(), reconcilePayouts), { headers });
  } catch (error) {
    console.error("[rewards] tick failed", error instanceof Error ? error.name : "error");
    return Response.json({ status: "failed", code: "internal_error" }, { status: 500, headers });
  }
}
