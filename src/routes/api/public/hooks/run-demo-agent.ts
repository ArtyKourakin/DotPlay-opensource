import { createFileRoute } from "@tanstack/react-router";

/**
 * Public scheduler hook for demonstration-agent activity, called by the
 * database scheduler (pg_cron via pg_net) every two minutes.
 *
 * Lives under /api/public/ because that prefix is reachable by external
 * callers; the handler itself always verifies the caller. Two accepted
 * credentials:
 *   1. A Bearer token stored server-side in demo_scheduler_tokens (used by
 *      the pg_cron job; the value never leaves the database).
 *   2. The platform LOVABLE_CRON_SECRET (fallback, kept for compatibility
 *      with Lovable-managed jobs).
 *
 * It performs at most one public action per invocation and refuses to do
 * anything unless both the environment gate (DEMO_AGENTS_ENABLED) and the
 * administrator switches (global_enabled + scheduler_enabled) are on.
 */

type TokenLookupClient = {
  from: (table: string) => {
    select: (columns: string) => Promise<{
      data: { token: string }[] | null;
      error: unknown;
    }>;
  };
};

async function bearerToken(request: Request): Promise<string | null> {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

async function matchesDatabaseToken(provided: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as unknown as TokenLookupClient;
    const { data, error } = await client.from("demo_scheduler_tokens").select("token");
    if (error || !data?.length) return false;
    const { timingSafeEqual } = await import("node:crypto");
    const providedBytes = Buffer.from(provided, "utf8");
    return data.some((row) => {
      const expectedBytes = Buffer.from(row.token, "utf8");
      return (
        providedBytes.length === expectedBytes.length &&
        timingSafeEqual(providedBytes, expectedBytes)
      );
    });
  } catch (error) {
    console.error("[demo-agents] scheduler token check failed", error);
    return false;
  }
}

async function authorize(request: Request): Promise<Response | null> {
  const token = await bearerToken(request);
  if (token && (await matchesDatabaseToken(token))) return null;

  const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
  return authenticateCronRequest(request);
}

export const Route = createFileRoute("/api/public/hooks/run-demo-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request) {
  const unauthorized = await authorize(request);
  if (unauthorized) return unauthorized;
  const power = await import("@/lib/site-power.server");
  if (!(await power.isSiteLive())) return power.siteOffResponse();

  const { runOneDemoAction } = await import("@/lib/demo-agents/runner.server");

  try {
    const { ensureDemoAgents } = await import("@/lib/demo-agents/seed.server");
    await ensureDemoAgents();
    // Roughly one run in three is a paper trade instead of a post/comment.
    if (Math.random() < 0.35) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: pool } = await supabaseAdmin
        .from("agents")
        .select("id, name, bio")
        .eq("is_demo", true)
        .eq("status", "active");
      const pick = pool?.[Math.floor(Math.random() * pool.length)];
      if (pick) {
        const { runAgentPaperTrade } = await import("@/lib/paper/trading.server");
        const r = await runAgentPaperTrade(pick);
        return Response.json({ ...r, username: pick.name }, { headers: { "cache-control": "no-store" } });
      }
    }
    const outcome = await runOneDemoAction({ triggerType: "schedule" });
    return Response.json(
      {
        status: outcome.status,
        code: outcome.code,
        message: outcome.message,
        action: outcome.action,
        username: outcome.username,
        prompt_tokens: outcome.promptTokens,
        completion_tokens: outcome.completionTokens,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Never leak provider bodies or stack traces to the caller.
    console.error("[demo-agents] scheduled run failed", error);
    return Response.json(
      {
        status: "failed",
        code: "internal_error",
        message: "The demo runner failed. Check the run history.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
