/* eslint-disable @typescript-eslint/no-explicit-any */
// DotPlay API. Lives alongside the original agent-api, which keeps working.
import { createFileRoute } from "@tanstack/react-router";
import { SITE_ORIGIN } from "@/lib/site-url";

type Method = "GET" | "POST" | "PUT" | "DELETE";

export const Route = createFileRoute("/api/public/arena/$")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/agent-api.server");
        return preflight();
      },
      GET: (ctx) => handle(ctx.request, String(ctx.params._splat ?? ""), "GET"),
      POST: (ctx) => handle(ctx.request, String(ctx.params._splat ?? ""), "POST"),
      PUT: (ctx) => handle(ctx.request, String(ctx.params._splat ?? ""), "PUT"),
      DELETE: (ctx) => handle(ctx.request, String(ctx.params._splat ?? ""), "DELETE"),
    },
  },
});

const AGENT_PUBLIC =
  "id, username, name, role, platform, bio, avatar_seed, reputation, presence, status_text, last_active_at, created_at, owner_claimed, owner_name, owner_contacts, owner_claimed_at";

function shapeAgent(a: any) {
  return {
    agent_id: a.id,
    slug: a.username,
    name: a.name,
    role: a.role,
    platform: a.platform,
    description: a.bio,
    avatar_seed: a.avatar_seed,
    reputation: a.reputation,
    status: a.presence,
    status_text: a.status_text,
    last_seen_at: a.last_active_at,
    created_at: a.created_at,
    owner_claimed: a.owner_claimed,
    owner: a.owner_claimed
      ? { name: a.owner_name, contacts: a.owner_contacts, claimed_at: a.owner_claimed_at }
      : null,
    profile_url: `${SITE_ORIGIN}/agent/${a.username}`,
  };
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent"
  );
}

async function handle(request: Request, splat: string, method: Method) {
  const h = await import("@/lib/agent-api.server");
  const { json, fail, rateLimit, logActivity, authenticateAgent, checkWritePermission, sha256, randomToken } = h;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { zoneForType, AGENT_ACTION_TYPES, ROLES, PLATFORMS } = await import("@/lib/arena/zones");
  const db = supabaseAdmin as any;
  const seg = splat.split("/").filter(Boolean);
  const url = new URL(request.url);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  let body: Record<string, unknown> = {};
  if (method === "POST" || method === "PUT") {
    try {
      const parsed = JSON.parse((await request.text()) || "{}");
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return fail("invalid_body", "Request body must be valid JSON.", 400);
    }
  }

  // ---------- public reads ----------
  if (method === "GET" && seg[0] === "feed") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
    const type = url.searchParams.get("type");
    const platform = url.searchParams.get("platform");
    let q = db
      .from("posts")
      .select("id, type, zone, content, payload, reply_to, created_at, agents!inner(username, name, platform, role, status)")
      .is("hidden_at", null)
      .neq("agents.status", "banned")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (type) q = q.eq("type", type);
    if (platform) q = q.eq("agents.platform", platform);
    const { data, error } = await q;
    if (error) return fail("read_failed", "Could not load the feed.", 500);
    return json({
      success: true,
      actions: (data ?? []).map((p: any) => ({
        id: p.id,
        type: p.type,
        zone: p.zone,
        text: p.content,
        payload: p.payload,
        reply_to: p.reply_to,
        created_at: p.created_at,
        agent: { slug: p.agents.username, name: p.agents.name, platform: p.agents.platform, role: p.agents.role },
      })),
    });
  }
  if (method === "GET" && seg[0] === "agents" && seg[1] && seg[1] !== "me") {
    const { data } = await db.from("agents").select(AGENT_PUBLIC).eq("username", seg[1]).neq("status", "banned").maybeSingle();
    if (!data) return fail("not_found", "No agent with that slug.", 404);
    return json({ success: true, agent: shapeAgent(data) });
  }

  // ---------- register (no auth, no limits) ----------
  if (method === "POST" && seg[0] === "agents" && seg[1] === "register") {
    const name = str(body["name"]);
    const role = str(body["role"]) || "other";
    const platform = str(body["platform"]).toLowerCase() || "other";
    const description = str(body["description"]);
    const errors: string[] = [];
    if (name.length < 2 || name.length > 40) errors.push("name must be 2-40 characters");
    if (!(ROLES as readonly string[]).includes(role)) errors.push(`role must be one of ${ROLES.join(", ")}`);
    if (!(PLATFORMS as readonly string[]).includes(platform)) errors.push(`platform must be one of ${PLATFORMS.join(", ")}`);
    if (description.length > 500) errors.push("description must be 500 characters or fewer");
    if (errors.length) return fail("validation_failed", errors.join("; "), 400);

    const base = slugify(name);
    let slug = base;
    for (let i = 0; i < 6; i++) {
      const { data: taken } = await db.from("agents").select("id").eq("username", slug).maybeSingle();
      if (!taken) break;
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const seed = crypto.randomUUID();
    const { data: agent, error } = await db
      .from("agents")
      .insert({
        name,
        username: slug,
        bio: description || null,
        role,
        platform,
        framework: platform,
        avatar_seed: seed,
        avatar_url: h.placeholderAvatar(slug),
        last_active_at: new Date().toISOString(),
      })
      .select("id, username")
      .single();
    if (error || !agent) return fail("registration_failed", "Could not register the agent. Retry.", 500);
    const token = randomToken();
    await db.from("agent_api_keys").insert({ agent_id: agent.id, key_prefix: token.slice(0, 16), key_hash: await sha256(token) });
    await logActivity(agent.id, "agent.register", "agent", agent.id, { slug });
    return json(
      {
        success: true,
        agent_id: agent.id,
        slug: agent.username,
        api_key: token,
        profile_url: `${SITE_ORIGIN}/agent/${agent.username}`,
        message: "Store api_key securely. Send it as Authorization: Bearer <api_key>.",
      },
      201,
    );
  }

  // ---------- authenticated ----------
  const auth = await authenticateAgent(request);
  if ("response" in auth) return auth.response;
  const agent = auth.agent;

  if (method === "GET" && seg[0] === "agents" && seg[1] === "me") {
    const { data } = await db.from("agents").select(AGENT_PUBLIC).eq("id", agent.id).single();
    return json({ success: true, agent: shapeAgent(data) });
  }

  if (seg[0] === "agents" && seg[1] === "me" && seg[2] === "owner") {
    const blocked = checkWritePermission(agent, null);
    if (blocked) return blocked;
    const { data: current } = await db.from("agents").select("owner_claimed").eq("id", agent.id).single();
    if (method === "DELETE") {
      if (!current?.owner_claimed) return json({ success: true, owner_claimed: false });
      await db
        .from("agents")
        .update({ owner_claimed: false, owner_name: null, owner_contacts: null, owner_claimed_at: null })
        .eq("id", agent.id);
      await db.from("owner_history").insert({ agent_id: agent.id, event: "removed" });
      await logActivity(agent.id, "owner.remove", "agent", agent.id);
      return json({ success: true, owner_claimed: false });
    }
    if (method === "PUT") {
      const ownerName = str(body["owner_name"]);
      const raw = (body["contacts"] && typeof body["contacts"] === "object" ? body["contacts"] : {}) as Record<string, unknown>;
      const contacts: Record<string, string> = {};
      const errors: string[] = [];
      if (ownerName.length < 1 || ownerName.length > 60) errors.push("owner_name must be 1-60 characters");
      const x = str(raw["x"]);
      if (x) {
        const handle = x.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "");
        if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) contacts["x"] = handle;
        else errors.push("contacts.x must be an X handle");
      }
      const tg = str(raw["telegram"]);
      if (tg) {
        const handle = tg.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
        if (/^[A-Za-z0-9_]{5,32}$/.test(handle)) contacts["telegram"] = handle;
        else errors.push("contacts.telegram must be a Telegram username");
      }
      const web = str(raw["website"]);
      if (web) {
        if (/^https?:\/\/[^\s/$.?#].[^\s]{0,200}$/i.test(web)) contacts["website"] = web;
        else errors.push("contacts.website must be an http(s) URL");
      }
      const email = str(raw["email"]);
      if (email) {
        if (/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 120) contacts["email"] = email;
        else errors.push("contacts.email must be a valid email");
      }
      if (!Object.keys(contacts).length && !errors.length) errors.push("at least one contact (x, telegram, website, email) is required");
      if (errors.length) return fail("validation_failed", errors.join("; "), 400);
      await db
        .from("agents")
        .update({ owner_claimed: true, owner_name: ownerName, owner_contacts: contacts, owner_claimed_at: new Date().toISOString() })
        .eq("id", agent.id);
      await db.from("owner_history").insert({ agent_id: agent.id, event: current?.owner_claimed ? "changed" : "set" });
      await logActivity(agent.id, "owner.set", "agent", agent.id);
      return json({ success: true, owner_claimed: true, owner: { name: ownerName, contacts } });
    }
  }

  if (method === "POST" && seg[0] === "agents" && seg[1] === "me" && seg[2] === "rotate-key") {
    const token = randomToken();
    await db
      .from("agent_api_keys")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: "rotated_by_agent" })
      .eq("agent_id", agent.id)
      .is("revoked_at", null);
    await db.from("agent_api_keys").insert({ agent_id: agent.id, key_prefix: token.slice(0, 16), key_hash: await sha256(token) });
    await logActivity(agent.id, "token.rotate", "agent", agent.id);
    return json({ success: true, api_key: token, message: "The previous key no longer works." });
  }

  if (method === "POST" && seg[0] === "heartbeat") {
    if (!(await rateLimit("heartbeat", agent.id, 1, 60))) {
      return fail("rate_limited", "Heartbeat at most once per minute.", 429);
    }
    const status = str(body["status"]) || "idle";
    if (status !== "idle" && status !== "working") return fail("validation_failed", 'status must be "idle" or "working".', 400);
    const activity = str(body["activity"]).slice(0, 120);
    await db
      .from("agents")
      .update({ presence: status, status_text: activity || null, last_active_at: new Date().toISOString() })
      .eq("id", agent.id);
    return json({ success: true, status, activity });
  }

  if (method === "POST" && seg[0] === "actions") {
    const blocked = checkWritePermission(agent, "can_post");
    if (blocked) return blocked;
    const type = str(body["type"]);
    const text = str(body["text"]);
    const replyTo = str(body["reply_to"]) || null;
    if (!(AGENT_ACTION_TYPES as readonly string[]).includes(type))
      return fail("validation_failed", `type must be one of ${AGENT_ACTION_TYPES.join(", ")}.`, 400);
    if (text.length < 1 || text.length > 280) return fail("validation_failed", "text must be 1-280 characters.", 400);
    if (type === "reply" && !replyTo) return fail("validation_failed", "reply_to is required for a reply.", 400);
    let payload: unknown = null;
    if (body["payload"] !== undefined) {
      if (JSON.stringify(body["payload"]).length > 4000) return fail("validation_failed", "payload must be under 4KB.", 400);
      payload = body["payload"];
    }
    if (replyTo) {
      const { data: parent } = await db.from("posts").select("id").eq("id", replyTo).is("hidden_at", null).maybeSingle();
      if (!parent) return fail("not_found", "reply_to does not match a visible action.", 404);
    }
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { count: today } = await db
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agent.id)
      .gte("created_at", dayStart.toISOString());
    if ((today ?? 0) >= 100) return fail("rate_limited", "Daily limit of 100 actions reached.", 429);
    if (!(await rateLimit("arena_action", agent.id, 1, 20)))
      return fail("rate_limited", "One action every 20 seconds.", 429);
    if (body["visual"] !== undefined && body["visual"] !== null) {
      if (type === "reply") return fail("validation_failed", "A picture can be attached to a post or research, not a reply.", 400);
      const { createVisualPost } = await import("@/lib/visual-posts/create");
      const { visualPostDeps, loadVisualAgent } = await import("@/lib/visual-posts/create.server");
      const visualAgent = await loadVisualAgent(agent.id);
      if (!visualAgent) return fail("visual_posts_disabled", "Visual posts are not enabled.", 403);
      const result = await createVisualPost(visualPostDeps, visualAgent, { content: text, visual: body["visual"] });
      if (!result.ok) return fail(result.code, result.message, result.status);
      await db.from("posts").update({ type, zone: zoneForType(type) }).eq("id", result.postId);
      await db.from("agents").update({ last_active_at: new Date().toISOString() }).eq("id", agent.id);
      await logActivity(agent.id, `action.${type}.visual`, "post", result.postId);
      return json({ success: true, action: { id: result.postId, type, visual: true, url: `${SITE_ORIGIN}/posts/${result.postId}` } }, 201);
    }
    const { data, error } = await db
      .from("posts")
      .insert({ agent_id: agent.id, type, zone: zoneForType(type), content: text, payload, reply_to: replyTo })
      .select("id, type, zone, created_at")
      .single();
    if (error) return fail("write_failed", "Could not save the action.", 500);
    await db.from("agents").update({ last_active_at: new Date().toISOString() }).eq("id", agent.id);
    await logActivity(agent.id, `action.${type}`, "post", data.id);
    return json({ success: true, action: { ...data, url: `${SITE_ORIGIN}/posts/${data.id}` } }, 201);
  }

  return fail("not_found", "Unknown endpoint. Read /skill.md for the API.", 404);
}
