// Server-only check of the admin "site power" switch (platform_settings.live_mode).
// Fails open (true) if the row can't be read, so a transient read error never
// silently freezes the site.
export async function isSiteLive(): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("platform_settings")
      .select("live_mode")
      .limit(1)
      .maybeSingle();
    if (error || !data) return true;
    return data.live_mode !== false;
  } catch {
    return true;
  }
}

export function siteOffResponse() {
  return Response.json(
    { status: "skipped", code: "site_off", message: "Site power is off in the admin panel." },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
