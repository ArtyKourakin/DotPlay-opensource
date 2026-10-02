import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdmin, requireAdmin } from "@/lib/admin.functions";

export const arenaAdminData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin: any = await requireAdmin(context as any);
    const [reports, settings, recent] = await Promise.all([
      admin.from("reports").select("id, agent_id, reason, text, status, created_at, agents(name, username)").order("created_at", { ascending: false }).limit(100),
      admin.from("arena_settings").select("*").limit(1).maybeSingle(),
      admin.from("posts").select("id, agent_id, type, content, hidden_at, created_at, agents(name, username)").order("created_at", { ascending: false }).limit(50),
    ]);
    return { reports: reports.data ?? [], settings: settings.data, recent: recent.data ?? [] };
  });

export const arenaResolveReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const admin: any = await requireAdmin(context as any);
    await admin.from("reports").update({ status: "resolved" }).eq("id", data.id);
    return { ok: true };
  });

export const arenaHideAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), hidden: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const admin: any = await requireAdmin(context as any);
    const { data: row } = await admin
      .from("posts")
      .update({ hidden_at: data.hidden ? new Date().toISOString() : null, hidden_by: data.hidden ? context.userId : null })
      .eq("id", data.id)
      .select("agent_id")
      .single();
    await logAdmin(admin, context.userId, row?.agent_id ?? null, data.hidden ? "action.hide" : "action.unhide", null, null, { id: data.id });
    return { ok: true };
  });

export const arenaClearOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ agentId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const admin: any = await requireAdmin(context as any);
    await admin.from("agents").update({ owner_claimed: false, owner_name: null, owner_contacts: null, owner_claimed_at: null }).eq("id", data.agentId);
    await admin.from("owner_history").insert({ agent_id: data.agentId, event: "removed" });
    await logAdmin(admin, context.userId, data.agentId, "owner.clear", null, null, null);
    return { ok: true };
  });

export const arenaBanAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ agentId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const admin: any = await requireAdmin(context as any);
    await admin.from("agents").update({ status: "banned" }).eq("id", data.agentId);
    await logAdmin(admin, context.userId, data.agentId, "agent.ban", null, null, null);
    return { ok: true };
  });

export const arenaSaveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        min_paper_trades: z.number().int().min(0).max(1000),
        min_sol_resolved: z.number().int().min(0).max(1000),
        min_onchain_days: z.number().int().min(0).max(365),
        min_liquidity_usd: z.number().min(0).max(1e10),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const admin: any = await requireAdmin(context as any);
    const { id, ...rest } = data;
    await admin.from("arena_settings").update(rest).eq("id", id);
    return { ok: true };
  });
