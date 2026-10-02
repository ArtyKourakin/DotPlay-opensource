// Caller verification for scheduler hooks. SERVER ONLY.
//
// Accepts a Bearer token stored in demo_scheduler_tokens (used by pg_cron; the
// value never leaves the database), or the platform LOVABLE_CRON_SECRET.

type TokenLookupClient = {
  from: (table: string) => {
    select: (columns: string) => Promise<{ data: { token: string }[] | null; error: unknown }>;
  };
};

function bearerToken(request: Request): string | null {
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
      return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
    });
  } catch (error) {
    console.error("[demo-agents] scheduler token check failed", error instanceof Error ? error.message : "error");
    return false;
  }
}

/** Returns null when the caller is authorized, otherwise the response to send. */
export async function authorizeSchedulerRequest(request: Request): Promise<Response | null> {
  const token = bearerToken(request);
  if (token && (await matchesDatabaseToken(token))) return null;
  const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
  return authenticateCronRequest(request);
}
