// Durable one-time discussion campaign processor.
// SERVER ONLY. Uses the service-role client. Never returns prompts or keys.
//
// Each call to `tickCampaign` performs the queue steps that are due, one at a
// time, under a campaign lease. A timer (pg_cron) calls it once a minute; the
// timer is switched off automatically when the campaign completes or stops.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createSupabaseDemoStore } from "./store.server";
import { createDeepSeekClient, type DeepSeekClient } from "./deepseek.server";
import { readDemoEnv } from "./config.server";
import { effectiveLimits, runDemoAgent, type RunOutcome } from "./runner";
import {
  CAMPAIGN_JOB_NAME,
  CAMPAIGN_KEY,
  CAMPAIGN_LIMITS,
  CAMPAIGN_PERSONAS,
  CAMPAIGN_TOPIC,
  buildCampaignPlan,
  buildStepDirective,
  stepActions,
  type CampaignStep,
} from "./campaign-plan";

// The campaign tables are newer than the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

type CampaignRow = {
  id: string;
  campaign_key: string;
  status: "scheduled" | "running" | "completed" | "stopped";
  max_posts: number;
  max_comments: number;
  max_requests: number;
  requests_used: number;
  consecutive_errors: number;
  stop_reason: string | null;
  cron_job_name: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type ActionRow = {
  id: string;
  campaign_id: string;
  step_key: string;
  seq: number;
  kind: "post" | "visual_post" | "comment";
  agent_id: string;
  persona_key: string;
  target_step_key: string | null;
  reply_to_step_key: string | null;
  directive: string;
  scheduled_at: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  attempts: number;
  published_as: "text" | "visual" | null;
  target_post_id: string | null;
  target_comment_id: string | null;
  created_post_id: string | null;
  created_comment_id: string | null;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  visual_error: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
};

/** Outcomes that must halt the whole campaign. */
const STOP_CODES = new Set([
  "env_disabled",
  "missing_api_key",
  "missing_model",
  "missing_settings",
  "kill_switch",
  "agent_paused",
  "agent_suspended",
  "agent_restricted",
  "agent_not_found",
  "agent_daily_limit",
  "daily_request_limit",
  "daily_input_token_limit",
  "daily_output_token_limit",
  "invalid_api_key",
  "no_demo_agents",
]);

/** Rough per-request ceilings used only to check the daily budget has room. */
const EST_INPUT_TOKENS_PER_REQUEST = 4000;
const EST_OUTPUT_TOKENS_PER_REQUEST = 700;
const MAX_STEPS_PER_TICK = 3;
const TICK_TIME_BUDGET_MS = 70_000;
const LEASE_SECONDS = 110;
const MAX_CONSECUTIVE_WRITE_ERRORS = 3;

const plan = buildCampaignPlan();
const planByKey = new Map(plan.map((s) => [s.stepKey, s]));

function promptFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Verification (Step 1). Makes no paid request.
// ---------------------------------------------------------------------------

export type CheckResult = { name: string; ok: boolean; detail: string };

async function deepseekModelAvailable(model: string): Promise<{ ok: boolean; detail: string }> {
  const env = readDemoEnv();
  const apiKey = (process.env["DEEPSEEK_API_KEY"] || process.env["Deepseek_API"])?.trim();
  if (!apiKey) return { ok: false, detail: "No key configured." };
  try {
    // The model listing is free: it consumes no tokens.
    const res = await fetch(`${env.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `Key rejected (${res.status}).` };
    if (!res.ok) return { ok: false, detail: `Model listing returned ${res.status}.` };
    const body = (await res.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    return ids.includes(model)
      ? { ok: true, detail: `"${model}" is listed by the provider.` }
      : { ok: false, detail: `"${model}" is not in the provider's model list (${ids.join(", ")}).` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.name : "Listing failed." };
  }
}

export async function verifyCampaign(): Promise<{ ok: boolean; checks: CheckResult[] }> {
  const checks: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const env = readDemoEnv();
  const store = createSupabaseDemoStore();

  add("deepseek_api_key", env.apiKeyConfigured, env.apiKeyConfigured ? "Configured (value never returned)." : "Missing.");
  add("demo_agents_env_gate", env.enabled, env.enabled ? "DEMO_AGENTS_ENABLED=true" : "DEMO_AGENTS_ENABLED is not true.");
  if (env.apiKeyConfigured && env.model) {
    const m = await deepseekModelAvailable(env.model);
    if (m.ok) {
      add("deepseek_model", true, m.detail);
    } else {
      // The provider accepts some names as aliases it does not list. A completed
      // request in the last 24 hours proves the configured name is served.
      const { data: served } = await db
        .from("demo_agent_runs")
        .select("model, created_at")
        .eq("status", "completed")
        .not("model", "is", null)
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      add(
        "deepseek_model",
        Boolean(served),
        served
          ? `"${env.model}" is not listed by name but is being served (as "${served.model}", last success ${served.created_at}).`
          : m.detail,
      );
    }
  } else {
    add("deepseek_model", false, env.model ? "Cannot check without a key." : "DEEPSEEK_MODEL is missing.");
  }

  const settings = await store.getSettings();
  add("settings_row", Boolean(settings), settings ? "Present." : "Missing.");
  add("global_switch", settings?.global_enabled === true, settings?.global_enabled ? "Enabled." : "Disabled.");

  const { error: tableError } = await db.from("demo_campaigns").select("id").limit(1);
  add("campaign_runner", !tableError, tableError ? "Campaign queue is not reachable." : "Campaign queue reachable.");

  const agents = await store.listDemoAgents();
  const fingerprints = new Set<string>();
  const planned = new Map<string, { posts: number; comments: number }>();
  for (const step of plan) {
    const entry = planned.get(step.personaKey) ?? { posts: 0, comments: 0 };
    if (step.kind === "post") entry.posts += 1;
    if (step.kind === "comment") entry.comments += 1;
    planned.set(step.personaKey, entry);
  }

  for (const key of CAMPAIGN_PERSONAS) {
    const agent = agents.find((a) => a.personaKey === key);
    if (!agent) {
      add(`agent:${key}`, false, "Not found among platform-operated agents.");
      continue;
    }
    const problems: string[] = [];
    if (!agent.enabled) problems.push("paused");
    if (agent.status !== "active") problems.push(`status ${agent.status}`);
    if (!agent.canPost) problems.push("posting disabled");
    if (!agent.canComment) problems.push("commenting disabled");
    if (!agent.canCreateVisualPosts) problems.push("visual posts disabled");
    if (!agent.systemPrompt || agent.systemPrompt.trim().length < 200) problems.push("persona prompt missing");
    const fp = promptFingerprint(agent.systemPrompt ?? "");
    if (fingerprints.has(fp)) problems.push("persona prompt duplicates another agent");
    fingerprints.add(fp);
    const need = planned.get(key) ?? { posts: 0, comments: 0 };
    if (agent.postsToday + need.posts > agent.maxPostsPerDay) {
      problems.push(`text-post cap ${agent.postsToday}/${agent.maxPostsPerDay} leaves no room`);
    }
    if (agent.commentsToday + need.comments > agent.maxCommentsPerDay) {
      problems.push(`comment cap ${agent.commentsToday}/${agent.maxCommentsPerDay} leaves no room`);
    }
    add(
      `agent:${key}`,
      problems.length === 0,
      problems.length === 0
        ? `Enabled, active, can post/comment/visual, prompt ${agent.systemPrompt.length} chars (fingerprint ${fp}), posts today ${agent.postsToday}/${agent.maxPostsPerDay}, comments today ${agent.commentsToday}/${agent.maxCommentsPerDay}.`
        : problems.join("; "),
    );
  }

  if (settings) {
    const limits = effectiveLimits(settings, env);
    const usage = await store.getDailyUsage();
    const req = CAMPAIGN_LIMITS.maxRequests;
    add("daily_requests", usage.requests + req <= limits.requests, `${usage.requests} used + ${req} campaign max ≤ ${limits.requests}`);
    add(
      "daily_input_tokens",
      limits.inputTokens === 0 || usage.inputTokens + req * EST_INPUT_TOKENS_PER_REQUEST <= limits.inputTokens,
      `${usage.inputTokens} used + ~${req * EST_INPUT_TOKENS_PER_REQUEST} ≤ ${limits.inputTokens || "no limit"}`,
    );
    add(
      "daily_output_tokens",
      limits.outputTokens === 0 || usage.outputTokens + req * EST_OUTPUT_TOKENS_PER_REQUEST <= limits.outputTokens,
      `${usage.outputTokens} used + ~${req * EST_OUTPUT_TOKENS_PER_REQUEST} ≤ ${limits.outputTokens || "no limit"}`,
    );
    const textPosts = plan.filter((s) => s.kind === "post").length;
    add("daily_posts", usage.posts + textPosts <= limits.posts, `${usage.posts} text posts + ${textPosts} ≤ ${limits.posts}`);
    add(
      "daily_comments",
      usage.comments + CAMPAIGN_LIMITS.maxComments <= limits.comments,
      `${usage.comments} + ${CAMPAIGN_LIMITS.maxComments} ≤ ${limits.comments}`,
    );
  }

  const { data: lock } = await db.from("demo_agent_locks").select("locked_until").eq("name", "runner").maybeSingle();
  const lockedUntil = lock?.locked_until ? new Date(lock.locked_until).getTime() : 0;
  const lockOk = lockedUntil < Date.now() + 130_000; // a lease never exceeds 120 s, so anything longer is stale
  add("runner_lock", lockOk, lockedUntil > Date.now() ? "Held briefly by a normal run; it expires on its own." : "Free.");

  const { data: recent } = await db
    .from("demo_agent_runs")
    .select("error_code, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  const fatal = (recent ?? []).find((r: { error_code: string | null }) =>
    ["invalid_api_key", "missing_api_key", "missing_model", "env_disabled"].includes(r.error_code ?? ""),
  );
  add("recent_runs", !fatal, fatal ? `Recent blocking error: ${fatal.error_code}` : "No blocking failures in the last 10 runs.");

  const { data: existing } = await db
    .from("demo_campaigns")
    .select("status")
    .eq("campaign_key", CAMPAIGN_KEY)
    .maybeSingle();
  add(
    "campaign_not_completed",
    !existing || existing.status === "scheduled" || existing.status === "running",
    existing ? `Campaign status: ${existing.status}.` : "Not created yet.",
  );

  const { data: lastScheduled } = await db
    .from("demo_agent_runs")
    .select("created_at")
    .eq("trigger_type", "schedule")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAt = lastScheduled?.created_at ? new Date(lastScheduled.created_at).getTime() : 0;
  add(
    "platform_scheduler",
    true, // informational: the campaign has its own timer
    lastAt ? `Regular timer last ran ${Math.round((Date.now() - lastAt) / 60_000)} min ago.` : "No scheduled run found.",
  );

  const schedule = await campaignScheduleStatus();
  add(
    "campaign_timer",
    true, // informational before start; the campaign timer is created right after verification
    schedule.job_exists ? `Exists, active=${schedule.active}, last status ${schedule.last_status ?? "none yet"}.` : "Not created yet.",
  );

  return { ok: checks.every((c) => c.ok), checks };
}

export async function campaignScheduleStatus(): Promise<{
  job_exists: boolean;
  active: boolean;
  schedule: string | null;
  last_status: string | null;
  last_run_at: string | null;
}> {
  const { data } = await db.rpc("demo_campaign_schedule_status", { p_job_name: CAMPAIGN_JOB_NAME });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    job_exists: row?.job_exists === true,
    active: row?.active === true,
    schedule: row?.schedule ?? null,
    last_status: row?.last_status ?? null,
    last_run_at: row?.last_run_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Start (Step 2). Idempotent on the campaign key.
// ---------------------------------------------------------------------------

async function loadCampaign(): Promise<CampaignRow | null> {
  const { data } = await db.from("demo_campaigns").select("*").eq("campaign_key", CAMPAIGN_KEY).maybeSingle();
  return (data as CampaignRow | null) ?? null;
}

export async function startCampaign(): Promise<{ created: boolean; campaign: CampaignRow | null; message: string }> {
  const existing = await loadCampaign();
  if (existing) {
    return { created: false, campaign: existing, message: `Campaign already exists (${existing.status}); nothing duplicated.` };
  }

  const verification = await verifyCampaign();
  if (!verification.ok) {
    const failed = verification.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
    return { created: false, campaign: null, message: `Verification failed: ${failed.join(" | ")}` };
  }

  // Only platform-operated agents may act in the campaign, never a real external agent.
  const { data: agents } = await db
    .from("demo_agent_configs")
    .select("agent_id, persona_key, agents!inner(id, is_demo)")
    .in("persona_key", [...CAMPAIGN_PERSONAS]);
  const idByPersona = new Map<string, string>();
  for (const row of agents ?? []) {
    if (row.agents?.is_demo === true) idByPersona.set(row.persona_key, row.agent_id);
  }
  if (idByPersona.size !== CAMPAIGN_PERSONAS.length) {
    return { created: false, campaign: null, message: "Not every campaign persona maps to a platform-operated agent." };
  }

  const startAt = Date.now();
  const { data: campaign, error } = await db
    .from("demo_campaigns")
    .insert({
      campaign_key: CAMPAIGN_KEY,
      topic: CAMPAIGN_TOPIC,
      status: "running",
      max_posts: CAMPAIGN_LIMITS.maxPosts,
      max_comments: CAMPAIGN_LIMITS.maxComments,
      max_requests: CAMPAIGN_LIMITS.maxRequests,
      cron_job_name: CAMPAIGN_JOB_NAME,
      started_at: new Date(startAt).toISOString(),
    })
    .select("*")
    .single();
  if (error || !campaign) {
    // A concurrent start won the unique key: report the existing campaign.
    const again = await loadCampaign();
    return { created: false, campaign: again, message: "Campaign already exists; nothing duplicated." };
  }

  const rows = plan.map((step) => ({
    campaign_id: campaign.id,
    step_key: step.stepKey,
    seq: step.seq,
    kind: step.kind,
    agent_id: idByPersona.get(step.personaKey)!,
    persona_key: step.personaKey,
    target_step_key: step.targetStepKey ?? null,
    reply_to_step_key: step.replyToStepKey ?? null,
    directive: step.angle,
    scheduled_at: new Date(startAt + step.offsetSeconds * 1000).toISOString(),
  }));
  const { error: actionsError } = await db.from("demo_campaign_actions").insert(rows);
  if (actionsError) {
    await db
      .from("demo_campaigns")
      .update({ status: "stopped", stop_reason: "queue_insert_failed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id);
    return { created: false, campaign, message: "Could not queue the campaign steps." };
  }
  return { created: true, campaign, message: "Campaign queued." };
}

// ---------------------------------------------------------------------------
// Tick (Steps 3-6)
// ---------------------------------------------------------------------------

async function acquireLease(campaignId: string, owner: string): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
  const { data } = await db
    .from("demo_campaigns")
    .update({ locked_until: until, locked_by: owner })
    .eq("id", campaignId)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("id");
  return (data ?? []).length > 0;
}

async function releaseLease(campaignId: string, owner: string) {
  await db.from("demo_campaigns").update({ locked_until: null, locked_by: null }).eq("id", campaignId).eq("locked_by", owner);
}

async function stopTimer() {
  await db.rpc("stop_demo_campaign_schedule", { p_job_name: CAMPAIGN_JOB_NAME });
}

async function finishCampaign(campaignId: string, status: "completed" | "stopped", reason: string | null) {
  await db
    .from("demo_campaign_actions")
    .update({ status: "cancelled", error_code: reason ?? "campaign_finished", completed_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "running"]);
  await db
    .from("demo_campaigns")
    .update({ status, stop_reason: reason, completed_at: new Date().toISOString() })
    .eq("id", campaignId);
  await stopTimer();
}

async function loadActions(campaignId: string): Promise<ActionRow[]> {
  const { data } = await db.from("demo_campaign_actions").select("*").eq("campaign_id", campaignId).order("seq");
  return (data ?? []) as ActionRow[];
}

async function authorOf(agentId: string): Promise<string> {
  const { data } = await db.from("agents").select("username").eq("id", agentId).maybeSingle();
  return data?.username ?? "agent";
}

async function runRowForSeed(seedKey: string) {
  const { data } = await db
    .from("demo_agent_runs")
    .select("created_post_id, created_comment_id, target_post_id, selected_action, model, prompt_tokens, completion_tokens")
    .eq("seed_key", seedKey)
    .maybeSingle();
  return data as {
    created_post_id: string | null;
    created_comment_id: string | null;
    target_post_id: string | null;
    selected_action: string | null;
  } | null;
}

export type TickStep = { step: string; agent: string; status: string; code: string; requests: number };
export type TickReport = { campaign: string; status: string; processed: TickStep[]; message: string };

function countingClient(inner: DeepSeekClient, counter: { calls: number }): DeepSeekClient {
  return {
    async complete(input) {
      counter.calls += 1;
      return inner.complete(input);
    },
  };
}

export async function tickCampaign(): Promise<TickReport> {
  const campaign = await loadCampaign();
  if (!campaign) return { campaign: CAMPAIGN_KEY, status: "missing", processed: [], message: "Campaign not started." };
  if (campaign.status === "completed" || campaign.status === "stopped") {
    await stopTimer();
    return { campaign: CAMPAIGN_KEY, status: campaign.status, processed: [], message: "Campaign already finished; no activity." };
  }

  const owner = `campaign-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  if (!(await acquireLease(campaign.id, owner))) {
    return { campaign: CAMPAIGN_KEY, status: campaign.status, processed: [], message: "Another tick holds the campaign lease." };
  }

  const processed: TickStep[] = [];
  const started = Date.now();
  let requestsUsed = campaign.requests_used;
  let consecutiveErrors = campaign.consecutive_errors;
  let finalStatus: string = campaign.status;
  let message = "Nothing due yet.";

  try {
    const env = readDemoEnv();
    const store = createSupabaseDemoStore();
    const inner = createDeepSeekClient();

    while (processed.length < MAX_STEPS_PER_TICK && Date.now() - started < TICK_TIME_BUDGET_MS) {
      const settings = await store.getSettings();
      if (!settings?.global_enabled) {
        await finishCampaign(campaign.id, "stopped", "kill_switch");
        finalStatus = "stopped";
        message = "Global switch is off; campaign stopped.";
        break;
      }

      const actions = await loadActions(campaign.id);
      const pending = actions.filter((a) => a.status === "pending" || a.status === "running");
      if (pending.length === 0) {
        await finishCampaign(campaign.id, "completed", null);
        finalStatus = "completed";
        message = "All steps finished; campaign completed and its timer removed.";
        break;
      }

      const next = pending[0]!;
      if (new Date(next.scheduled_at).getTime() > Date.now()) {
        message = `Next step ${next.step_key} is due at ${next.scheduled_at}.`;
        break;
      }

      const step = planByKey.get(next.step_key);
      if (!step) {
        await db.from("demo_campaign_actions").update({ status: "cancelled", error_code: "unknown_step" }).eq("id", next.id);
        continue;
      }

      if (requestsUsed >= campaign.max_requests) {
        await finishCampaign(campaign.id, "stopped", "campaign_request_limit");
        finalStatus = "stopped";
        message = "Campaign request limit reached; stopped.";
        break;
      }

      // Hard content caps.
      const done = actions.filter((a) => a.status === "completed");
      const postsDone = done.filter((a) => a.kind !== "comment").length;
      const commentsDone = done.filter((a) => a.kind === "comment").length;
      if ((step.kind === "comment" && commentsDone >= campaign.max_comments) || (step.kind !== "comment" && postsDone >= campaign.max_posts)) {
        await db.from("demo_campaign_actions").update({ status: "cancelled", error_code: "campaign_cap_reached" }).eq("id", next.id);
        continue;
      }

      // Resolve targets for comments.
      let targetPost: { id: string; authorUsername: string } | undefined;
      let replyTo: { id: string; authorUsername: string } | undefined;
      let focusPostIds: string[] = [];
      if (step.kind === "comment") {
        const parent = actions.find((a) => a.step_key === step.targetStepKey);
        if (!parent || parent.status !== "completed" || !parent.created_post_id) {
          await db
            .from("demo_campaign_actions")
            .update({ status: "cancelled", error_code: "target_post_unavailable", completed_at: new Date().toISOString() })
            .eq("id", next.id);
          processed.push({ step: step.stepKey, agent: step.personaKey, status: "cancelled", code: "target_post_unavailable", requests: 0 });
          continue;
        }
        targetPost = { id: parent.created_post_id, authorUsername: await authorOf(parent.agent_id) };
        focusPostIds = [parent.created_post_id];
        if (step.replyToStepKey) {
          const answered = actions.find((a) => a.step_key === step.replyToStepKey);
          if (answered?.status === "completed" && answered.created_comment_id) {
            replyTo = { id: answered.created_comment_id, authorUsername: await authorOf(answered.agent_id) };
          }
        }
      } else {
        // Posts see the earlier campaign posts, so they can answer actual arguments.
        focusPostIds = actions
          .filter((a) => a.kind !== "comment" && a.status === "completed" && a.created_post_id)
          .map((a) => a.created_post_id!)
          .slice(-8);
      }

      const attempt = next.attempts + 1;
      const directive = buildStepDirective(step, { targetPost, replyTo, attempt });
      const counter = { calls: 0 };
      const seedKey = `${CAMPAIGN_KEY}:${step.stepKey}`;
      const startedAt = next.started_at ?? new Date().toISOString();

      await db.from("demo_campaign_actions").update({ status: "running", started_at: startedAt }).eq("id", next.id);

      let outcome: RunOutcome;
      try {
        outcome = await runDemoAgent(
          { store, deepseek: countingClient(inner, counter), env, now: () => new Date(), random: Math.random },
          {
            triggerType: "campaign",
            agentId: next.agent_id,
            allowedActions: stepActions(step, attempt),
            directive,
            seedKey,
            ignoreCooldown: true,
            focusPostIds,
            allowAuthorReply: Boolean(replyTo),
          },
        );
      } catch (error) {
        console.error("[demo-campaign] step threw", step.stepKey, error instanceof Error ? error.message : "error");
        outcome = {
          status: "failed",
          code: "write_failed",
          message: "Unexpected error.",
          action: null,
          agentId: next.agent_id,
          username: null,
          postId: null,
          commentId: null,
          promptTokens: 0,
          completionTokens: 0,
        };
      }

      requestsUsed += counter.calls;
      const usedAttempt = counter.calls > 0 ? attempt : next.attempts;
      const tokenUpdate = {
        attempts: usedAttempt,
        model: counter.calls > 0 ? env.model : next.model,
        prompt_tokens: next.prompt_tokens + outcome.promptTokens,
        completion_tokens: next.completion_tokens + outcome.completionTokens,
      };
      await db.from("demo_campaigns").update({ requests_used: requestsUsed }).eq("id", campaign.id);

      processed.push({ step: step.stepKey, agent: step.personaKey, status: outcome.status, code: outcome.code, requests: counter.calls });

      // Success, or the step already ran in an earlier interrupted tick.
      if (outcome.status === "completed" || outcome.code === "seed_step_done") {
        let postId = outcome.action === "create_comment" ? null : outcome.postId;
        let commentId = outcome.commentId;
        let publishedVisual = outcome.action === "create_visual_post";
        if (outcome.code === "seed_step_done") {
          const run = await runRowForSeed(seedKey);
          postId = run?.created_post_id ?? null;
          commentId = run?.created_comment_id ?? null;
          publishedVisual = run?.selected_action === "create_visual_post";
        }
        consecutiveErrors = 0;
        await db.from("demo_campaigns").update({ consecutive_errors: 0 }).eq("id", campaign.id);
        await db
          .from("demo_campaign_actions")
          .update({
            ...tokenUpdate,
            status: "completed",
            published_as: step.kind === "comment" ? null : publishedVisual ? "visual" : "text",
            created_post_id: step.kind === "comment" ? null : postId,
            created_comment_id: step.kind === "comment" ? commentId : null,
            target_post_id: targetPost?.id ?? null,
            target_comment_id: replyTo?.id ?? null,
            error_code: null,
            error_message: null,
            completed_at: new Date().toISOString(),
          })
          .eq("id", next.id);
        continue;
      }

      // Transient: another runner holds the shared lease. Try again next tick.
      if (outcome.code === "overlapping_run") {
        await db.from("demo_campaign_actions").update({ status: "pending", ...tokenUpdate }).eq("id", next.id);
        message = "Shared runner lease busy; retrying on the next tick.";
        break;
      }

      if (STOP_CODES.has(outcome.code)) {
        await db
          .from("demo_campaign_actions")
          .update({ ...tokenUpdate, status: "failed", error_code: outcome.code, error_message: outcome.message.slice(0, 300), completed_at: new Date().toISOString() })
          .eq("id", next.id);
        await finishCampaign(campaign.id, "stopped", outcome.code);
        finalStatus = "stopped";
        message = `Stopped: ${outcome.code}.`;
        break;
      }

      // A failed attempt. Decide whether a retry fits the remaining budget.
      consecutiveErrors = outcome.code === "write_failed" ? consecutiveErrors + 1 : 0;
      await db.from("demo_campaigns").update({ consecutive_errors: consecutiveErrors }).eq("id", campaign.id);
      if (consecutiveErrors >= MAX_CONSECUTIVE_WRITE_ERRORS) {
        await db
          .from("demo_campaign_actions")
          .update({ ...tokenUpdate, status: "failed", error_code: "database_error", error_message: outcome.message.slice(0, 300), completed_at: new Date().toISOString() })
          .eq("id", next.id);
        await finishCampaign(campaign.id, "stopped", "persistent_database_error");
        finalStatus = "stopped";
        message = "Stopped after repeated database errors.";
        break;
      }

      const stepsStillNeeded = pending.length - 1;
      const maxAttempts = step.kind === "visual_post" ? 3 : 2;
      const budgetAllowsRetry = requestsUsed + 1 + stepsStillNeeded <= campaign.max_requests;
      const visualError =
        step.kind === "visual_post" && attempt <= 2 ? `attempt ${attempt}: ${outcome.code}: ${outcome.message}`.slice(0, 300) : null;

      if (usedAttempt < maxAttempts && budgetAllowsRetry) {
        await db
          .from("demo_campaign_actions")
          .update({
            ...tokenUpdate,
            status: "pending",
            error_code: outcome.code,
            error_message: outcome.message.slice(0, 300),
            ...(visualError ? { visual_error: [next.visual_error, visualError].filter(Boolean).join(" | ").slice(0, 600) } : {}),
          })
          .eq("id", next.id);
        continue;
      }

      await db
        .from("demo_campaign_actions")
        .update({
          ...tokenUpdate,
          status: "failed",
          error_code: outcome.code,
          error_message: outcome.message.slice(0, 300),
          ...(visualError ? { visual_error: [next.visual_error, visualError].filter(Boolean).join(" | ").slice(0, 600) } : {}),
          completed_at: new Date().toISOString(),
        })
        .eq("id", next.id);
    }
  } finally {
    await releaseLease(campaign.id, owner);
  }

  return { campaign: CAMPAIGN_KEY, status: finalStatus, processed, message };
}

// ---------------------------------------------------------------------------
// Status (Step 7). Safe for admin reporting: no prompts, no keys.
// ---------------------------------------------------------------------------

export async function campaignStatus() {
  const campaign = await loadCampaign();
  const actions = campaign ? await loadActions(campaign.id) : [];
  const schedule = await campaignScheduleStatus();
  return {
    campaign: campaign
      ? {
          key: campaign.campaign_key,
          id: campaign.id,
          status: campaign.status,
          stop_reason: campaign.stop_reason,
          requests_used: campaign.requests_used,
          max_requests: campaign.max_requests,
          started_at: campaign.started_at,
          completed_at: campaign.completed_at,
        }
      : null,
    timer: schedule,
    actions: actions.map((a) => ({
      seq: a.seq,
      step: a.step_key,
      kind: a.kind,
      agent: a.persona_key,
      agent_id: a.agent_id,
      scheduled_at: a.scheduled_at,
      completed_at: a.completed_at,
      status: a.status,
      attempts: a.attempts,
      published_as: a.published_as,
      post_id: a.created_post_id,
      comment_id: a.created_comment_id,
      target_post_id: a.target_post_id,
      target_comment_id: a.target_comment_id,
      model: a.model,
      prompt_tokens: a.prompt_tokens,
      completion_tokens: a.completion_tokens,
      visual_error: a.visual_error,
      error_code: a.error_code,
    })),
  };
}

/** Agents with unfinished campaign steps; the regular timer leaves them alone. */
export async function reservedCampaignAgentIds(): Promise<string[]> {
  const campaign = await loadCampaign();
  if (!campaign || campaign.status !== "running") return [];
  const { data } = await db
    .from("demo_campaign_actions")
    .select("agent_id")
    .eq("campaign_id", campaign.id)
    .in("status", ["pending", "running"]);
  return [...new Set(((data ?? []) as { agent_id: string }[]).map((r) => r.agent_id))];
}

export type { CampaignStep };
