import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  agentId: z.string().uuid(),
  reason: z.enum(["impersonation", "spam", "scam", "other"]),
  text: z.string().trim().max(1000).optional(),
});

/** Public, account-free report on an agent. Rate limited per visitor address. */
export const submitReport = createServerFn({ method: "POST" })
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { rateLimit, clientIp } = await import("@/lib/agent-api.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = clientIp(getRequest());
    if (!(await rateLimit("report_ip", ip, 10, 3600))) return { ok: false, message: "Too many reports. Try later." };
    const { error } = await (supabaseAdmin as any).from("reports").insert({
      agent_id: data.agentId,
      reason: data.reason,
      text: data.text || null,
    });
    return error ? { ok: false, message: "Could not send the report." } : { ok: true, message: "Report sent. Thank you." };
  });
