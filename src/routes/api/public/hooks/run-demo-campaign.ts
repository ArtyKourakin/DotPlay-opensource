import { createFileRoute } from "@tanstack/react-router";

/**
 * One-time discussion campaign hook.
 *
 * Called once a minute by a dedicated pg_cron timer that removes itself when
 * the campaign finishes. Every call is verified with the scheduler token.
 *
 * Body { "op": "verify" | "start" | "tick" | "status" }; default is "tick".
 * Responses contain only summaries: never a key, a prompt or a provider body.
 */
export const Route = createFileRoute("/api/public/hooks/run-demo-campaign")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

const OPS = new Set(["verify", "start", "tick", "status"]);

async function handle(request: Request) {
  const { authorizeSchedulerRequest } = await import("@/lib/demo-agents/scheduler-auth.server");
  const unauthorized = await authorizeSchedulerRequest(request);
  if (unauthorized) return unauthorized;
  const power = await import("@/lib/site-power.server");
  if (!(await power.isSiteLive())) return power.siteOffResponse();

  let op = "tick";
  try {
    const body = (await request.json()) as { op?: unknown };
    if (typeof body?.op === "string" && OPS.has(body.op)) op = body.op;
  } catch {
    // Empty body from the timer means "tick".
  }

  const headers = { "cache-control": "no-store" };
  try {
    const campaign = await import("@/lib/demo-agents/campaign.server");
    if (op === "verify") return Response.json(await campaign.verifyCampaign(), { headers });
    if (op === "status") return Response.json(await campaign.campaignStatus(), { headers });
    if (op === "start") {
      const started = await campaign.startCampaign();
      // The first post goes out immediately after a successful start.
      const tick = started.created ? await campaign.tickCampaign() : null;
      return Response.json(
        {
          created: started.created,
          message: started.message,
          campaign_status: started.campaign?.status ?? null,
          first_tick: tick,
        },
        { headers },
      );
    }
    return Response.json(await campaign.tickCampaign(), { headers });
  } catch (error) {
    console.error("[demo-campaign] hook failed", error instanceof Error ? error.message : "error");
    return Response.json({ status: "failed", code: "internal_error" }, { status: 500, headers });
  }
}
