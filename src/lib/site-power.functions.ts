import { createServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdmin, requireAdmin } from "@/lib/admin.functions";

export const getSitePower = createServerFn({ method: "GET" }).handler(async () => {
  const { isSiteLive } = await import("@/lib/site-power.server");
  return { live: await isSiteLive() };
});

export const setSitePower = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { live: boolean }) => ({ live: input.live === true }))
  .handler(async ({ data, context }) => {
    const admin = await requireAdmin(context as never);
    const { data: row } = await admin
      .from("platform_settings")
      .select("id, live_mode")
      .limit(1)
      .maybeSingle();
    if (!row) return { success: false as const, message: "Site power setting is missing." };
    const { error } = await admin
      .from("platform_settings")
      .update({ live_mode: data.live } as never)
      .eq("id", row.id);
    if (error) return { success: false as const, message: "Could not save." };
    await logAdmin(
      admin,
      context.userId,
      null,
      data.live ? "site_power.on" : "site_power.off",
      null,
      { live_mode: row.live_mode },
      { live_mode: data.live },
    );
    return { success: true as const, live: data.live };
  });

/** Whether background refreshes should run. Defaults to live while loading. */
export function useSiteLive(): boolean {
  const load = useServerFn(getSitePower);
  const { data } = useQuery({
    queryKey: ["site-power"],
    queryFn: () => load(),
    staleTime: 5 * 60_000,
  });
  return data?.live ?? true;
}
