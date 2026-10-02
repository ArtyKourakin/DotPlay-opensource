/* eslint-disable @typescript-eslint/no-explicit-any */
// Administrator RPCs for Karma Rewards. Every function runs requireSupabaseAuth
// and then requireAdmin (the existing `has_role(…, 'admin')` check) before any
// data is read, and every mutation requires a reason and writes an audit
// record. Server modules are imported inside the handlers only, so nothing
// server-side is bundled into the browser.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin.functions";

async function adminDeps(context: any) {
  const admin = await requireAdmin(context);
  const { rewardDeps, walletCrypto, signatureCrypto } =
    await import("@/lib/rewards/runtime.server");
  return {
    admin,
    deps: rewardDeps(),
    walletCrypto,
    signatureCrypto,
    adminId: String(context.userId),
  };
}

/** Converts bigint values for the RPC boundary (JSON has no bigint). */
function plain<T>(value: T): any {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function mirrorToAdminLog(
  admin: any,
  adminId: string,
  agentId: string | null,
  action: string,
  reason: string,
  next: unknown,
) {
  // The existing admin_action_logs table keeps the per-agent admin history view
  // complete; the append-only reward_audit_events table is the authoritative log.
  await admin.from("admin_action_logs").insert({
    admin_user_id: adminId,
    target_agent_id: agentId,
    action,
    reason,
    previous_values: null,
    new_values: plain(next ?? null),
  });
}

function failed(error: unknown) {
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : "The action could not be completed.";
  if (error && typeof error === "object" && "status" in error && "code" in error)
    return { success: false as const, code: code ?? "failed", message };
  console.error("[rewards-admin] action failed", error instanceof Error ? error.name : "error");
  return { success: false as const, code: "failed", message: "The action could not be completed." };
}

export const rewardsAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { deps } = await adminDeps(context as any);
    const { describeRewardEnv } = await import("@/lib/rewards/config.server");
    const { loadSettings, computeEpochDistribution } = await import("@/lib/rewards/service");
    const { resolveRewardMode } = await import("@/lib/rewards/eligibility");
    const { row, settings } = await loadSettings(deps);
    if (!row) return { available: false as const, env: describeRewardEnv(deps.env) };
    const [pool, epochs, agents, profiles, wallets, audit] = await Promise.all([
      deps.store.getPoolState(),
      deps.store.listEpochs({ limit: 30 }),
      deps.store.listAgents(),
      deps.store.listProfiles(),
      deps.store.listCurrentWallets(),
      deps.store.listAudit({ limit: 50 }),
    ]);
    const open = epochs.find((e) => e.state === "open");
    const estimate = open ? await computeEpochDistribution(deps, settings, open) : null;
    const rowsByAgent = new Map((estimate?.rows ?? []).map((r) => [r.agent_id, r]));
    const lifetime = await deps.store.lifetimeKarma(null);
    const profileMap = new Map(profiles.map((p) => [p.agent_id, p]));
    const walletUse = new Map<string, number>();
    for (const w of wallets)
      walletUse.set(w.wallet_address, (walletUse.get(w.wallet_address) ?? 0) + 1);
    const walletMap = new Map(wallets.map((w) => [w.agent_id, w]));
    const finalized = new Map<string, { total: bigint }>();
    for (const e of epochs.filter((x) => x.approved_at)) {
      for (const a of await deps.store.listAllocations(e.id)) {
        if (a.status === "payable" || a.status === "paid")
          finalized.set(a.agent_id, {
            total: (finalized.get(a.agent_id)?.total ?? 0n) + a.payable_lamports,
          });
      }
    }
    const lastPayouts = new Map<string, any>();
    for (const e of epochs.slice(0, 14)) {
      for (const p of await deps.store.listPayouts({ epochId: e.id })) {
        const prev = lastPayouts.get(p.agent_id);
        if (!prev || prev.created_at < p.created_at) lastPayouts.set(p.agent_id, p);
      }
    }
    return plain({
      available: true as const,
      env: describeRewardEnv(deps.env),
      settings_row: row,
      effective: settings,
      pool: pool ? { ...pool, public_snapshot: undefined } : null,
      epochs,
      estimate_totals: estimate?.totals ?? null,
      agents: agents.map((a) => {
        const w = walletMap.get(a.id) ?? null;
        const r = rowsByAgent.get(a.id);
        const p = profileMap.get(a.id);
        return {
          id: a.id,
          name: a.name,
          username: a.username,
          status: a.status,
          is_demo: a.is_demo,
          demo_persona_key: a.demo_persona_key,
          created_at: a.created_at,
          reward_mode: resolveRewardMode(a, p),
          has_profile: Boolean(p),
          monetary_enabled: p ? p.monetary_enabled : true,
          admin_notes: p?.admin_notes ?? null,
          wallet: w,
          shared_wallet_count: w ? (walletUse.get(w.wallet_address) ?? 0) : 0,
          daily_karma: r?.daily_karma ?? 0n,
          estimated_lamports: r ? r.gross_lamports : 0n,
          estimate_status: r?.status ?? null,
          estimate_reason: r?.ineligibility_reason ?? null,
          flags: r?.flags ?? [],
          lifetime_karma: lifetime.get(a.id) ?? 0n,
          lifetime_rewards_lamports: finalized.get(a.id)?.total ?? 0n,
          last_payout: lastPayouts.get(a.id) ?? null,
        };
      }),
      audit,
    });
  });

export const rewardsAdminEpochDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { epochId: string; preview?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { deps } = await adminDeps(context as any);
    const { loadSettings, computeEpochDistribution } = await import("@/lib/rewards/service");
    const { settings } = await loadSettings(deps);
    const epochId = z.string().uuid().parse(data.epochId);
    const epoch = await deps.store.getEpoch(epochId);
    if (!epoch) return { found: false as const };
    const [allocations, events, fees, exclusions, batches, payouts] = await Promise.all([
      deps.store.listAllocations(epoch.id),
      deps.store.listKarmaEvents(epoch.id),
      deps.store.listFeeTransfers(epoch.starts_at, epoch.ends_at),
      deps.store.listExclusions(epoch.id),
      deps.store.listBatches(epoch.id),
      deps.store.listPayouts({ epochId: epoch.id }),
    ]);
    // A preview recomputes the table from current data without writing anything.
    const preview = data.preview ? await computeEpochDistribution(deps, settings, epoch) : null;
    return plain({
      found: true as const,
      epoch,
      allocations,
      preview: preview ? { rows: preview.rows, totals: preview.totals } : null,
      events: events.slice(0, 2000),
      event_count: events.length,
      fees,
      exclusions,
      batches,
      payouts,
    });
  });

export const rewardsAdminAgentWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const { deps } = await adminDeps(context as any);
    const agentId = z.string().uuid().parse(data.agentId);
    const [history, allocations, payouts, audit, wallets] = await Promise.all([
      deps.store.listWalletHistory(agentId),
      deps.store.listAgentAllocations(agentId, 60),
      deps.store.listAgentPayouts(agentId, 60),
      deps.store.listAudit({ agentId, limit: 100 }),
      deps.store.listCurrentWallets(),
    ]);
    const current = history.find((w) => w.is_current) ?? null;
    const sharedWith = current
      ? wallets
          .filter((w) => w.wallet_address === current.wallet_address && w.agent_id !== agentId)
          .map((w) => w.agent_id)
      : [];
    return plain({ history, allocations, payouts, audit, shared_with_agent_ids: sharedWith });
  });

export const rewardsAdminExportPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { batchId: string }) => input)
  .handler(async ({ data, context }) => {
    const { deps } = await adminDeps(context as any);
    const { exportPayoutPlan } = await import("@/lib/rewards/payouts");
    const exported = await exportPayoutPlan(deps, z.string().uuid().parse(data.batchId));
    return plain({ json: exported.json, csv: exported.csv, cli: exported.cli });
  });

const bps = z.number().int().min(0).max(10000);
const settingsPatch = z
  .object({
    karma_enabled: z.boolean(),
    distribution_enabled: z.boolean(),
    distribution_bps: bps,
    max_agent_share_bps: bps.min(1),
    max_wallet_share_bps: bps.min(1),
    pilot_payouts_enabled: z.boolean(),
    public_payouts_enabled: z.boolean(),
    pilot_aggregate_share_bps: bps,
    min_daily_karma: z.number().int().min(0).max(1_000_000),
    min_agent_age_hours: z.number().int().min(0).max(8760),
    min_source_agent_age_hours: z.number().int().min(0).max(8760),
    pair_daily_cap: z.number().int().min(0).max(100),
    min_payout_lamports: z.string().regex(/^\d{1,15}$/),
    epoch_hour_utc: z.number().int().min(0).max(23),
    finalization_delay_hours: z.number().int().min(0).max(72),
    duplicate_lookback_days: z.number().int().min(0).max(365),
    min_post_chars: z.number().int().min(0).max(5000),
    min_comment_chars: z.number().int().min(0).max(2000),
    min_meaningful_comment_chars: z.number().int().min(0).max(2000),
    excluded_post_types: z.array(z.string().trim().min(1).max(60)).max(20),
    scoring: z.record(
      z.enum(["post_created", "comment_created", "comment_received", "reaction_received"]),
      z.object({
        points: z.number().int().min(0).max(1000),
        daily_cap: z.number().int().min(0).max(1000),
      }),
    ),
    fee_source_allowlist: z.array(z.string().trim().min(32).max(44)).max(50),
  })
  .partial()
  .strict();

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_settings"), patch: settingsPatch }),
  z.object({ action: z.literal("run_tick") }),
  z.object({ action: z.literal("refresh_pool") }),
  z.object({ action: z.literal("prepare_pilot"), dryRun: z.boolean() }),
  z.object({
    action: z.literal("set_profile"),
    agentId: z.string().uuid(),
    mode: z.enum(["disabled", "karma_only", "pilot", "public"]),
    monetaryEnabled: z.boolean(),
    adminNotes: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    action: z.literal("assign_wallet"),
    agentId: z.string().uuid(),
    walletAddress: z.string().max(200),
    status: z.enum(["submitted", "admin_verified_pilot"]),
    confirm: z.boolean(),
  }),
  z.object({
    action: z.literal("revoke_wallet"),
    agentId: z.string().uuid(),
    confirm: z.boolean(),
  }),
  z.object({ action: z.literal("calculate_epoch"), epochId: z.string().uuid() }),
  z.object({
    action: z.literal("approve_epoch"),
    epochId: z.string().uuid(),
    calculationVersion: z.number().int().min(1),
  }),
  z.object({ action: z.literal("cancel_epoch"), epochId: z.string().uuid() }),
  z.object({ action: z.literal("invalidate_event"), eventId: z.string().uuid() }),
  z.object({ action: z.literal("restore_event"), eventId: z.string().uuid() }),
  z.object({
    action: z.literal("exclude_agent"),
    epochId: z.string().uuid(),
    agentId: z.string().uuid(),
    exclude: z.boolean(),
  }),
  z.object({ action: z.literal("exclude_fee"), feeId: z.string().uuid(), exclude: z.boolean() }),
  z.object({ action: z.literal("create_batch"), epochId: z.string().uuid() }),
  z.object({
    action: z.literal("submit_signature"),
    payoutIds: z.array(z.string().uuid()).min(1).max(20),
    signature: z.string().max(200),
  }),
  z.object({ action: z.literal("reconcile") }),
  z.object({ action: z.literal("release_payout"), payoutId: z.string().uuid() }),
  z.object({ action: z.literal("cancel_batch"), batchId: z.string().uuid() }),
]);

export const rewardsAdminMutate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reason: string } & Record<string, unknown>) => input)
  .handler(async ({ data, context }) => {
    const { admin, deps, walletCrypto, signatureCrypto, adminId } = await adminDeps(context as any);
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason)
      return { success: false as const, code: "reason_required", message: "A reason is required." };
    if (reason.length > 1000)
      return {
        success: false as const,
        code: "reason_too_long",
        message: "Keep the reason under 1000 characters.",
      };
    const { reason: _omit, ...rest } = data;
    const parsed = mutation.safeParse(rest);
    if (!parsed.success)
      return {
        success: false as const,
        code: "validation_failed",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      };
    const input = parsed.data;
    try {
      const service = await import("@/lib/rewards/service");
      const payouts = await import("@/lib/rewards/payouts");
      const wallets = await import("@/lib/rewards/wallet-service");
      const { settings, row } = await service.loadSettings(deps);
      let result: unknown = null;
      let agentId: string | null = null;
      switch (input.action) {
        case "update_settings": {
          if (!row)
            return {
              success: false as const,
              code: "unavailable",
              message: "Apply the Karma Rewards migration first.",
            };
          const patch = { ...input.patch } as Record<string, unknown>;
          const invalidSource = (input.patch.fee_source_allowlist ?? []).find(
            (a) => !deps.isValidPoolAddress(a),
          );
          if (invalidSource)
            return {
              success: false as const,
              code: "invalid_address",
              message: `Not a valid Solana address: ${invalidSource}`,
            };
          await deps.store.updateSettings(patch as never);
          await deps.store.audit({
            actor_type: "admin",
            actor_id: adminId,
            action: "settings.updated",
            reason,
            previous_values: Object.fromEntries(
              Object.keys(patch).map((k) => [k, (row as any)[k]]),
            ),
            new_values: patch,
          });
          break;
        }
        case "run_tick":
          result = await service.runRewardsTick(deps, payouts.reconcilePayouts);
          break;
        case "refresh_pool":
          result = await service.refreshPool(deps, settings);
          break;
        case "prepare_pilot":
          result = await service.preparePilotAgents(deps, {
            adminId,
            reason,
            dryRun: input.dryRun,
          });
          break;
        case "set_profile":
          agentId = input.agentId;
          await service.setAgentProfile(deps, {
            agentId: input.agentId,
            mode: input.mode,
            monetaryEnabled: input.monetaryEnabled,
            ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
            adminId,
            reason,
          });
          break;
        case "assign_wallet":
          agentId = input.agentId;
          result = await wallets.adminAssignWallet(deps, walletCrypto, {
            agentId: input.agentId,
            walletAddress: input.walletAddress,
            status: input.status,
            confirm: input.confirm,
            reason,
            adminId,
            body: { walletAddress: input.walletAddress, reason },
          });
          if ((result as { saved: boolean }).saved === false)
            return {
              success: false as const,
              code: "confirmation_required",
              message: "Confirmation required.",
              result: plain(result),
            };
          break;
        case "revoke_wallet":
          agentId = input.agentId;
          await wallets.adminRevokeWallet(deps, {
            agentId: input.agentId,
            adminId,
            reason,
            confirm: input.confirm,
          });
          break;
        case "calculate_epoch": {
          const outcome = await service.calculateEpoch(deps, settings, input.epochId, {
            type: "admin",
            id: adminId,
            reason,
          });
          if (!outcome.ok)
            return { success: false as const, code: outcome.code, message: outcome.message };
          result = outcome;
          break;
        }
        case "approve_epoch":
          await service.approveEpoch(deps, settings, {
            epochId: input.epochId,
            calculationVersion: input.calculationVersion,
            adminId,
            reason,
          });
          break;
        case "cancel_epoch":
          await service.cancelEpoch(deps, { epochId: input.epochId, adminId, reason });
          break;
        case "invalidate_event":
          await service.invalidateKarmaEvent(deps, { eventId: input.eventId, adminId, reason });
          break;
        case "restore_event":
          await service.restoreKarmaEvent(deps, { eventId: input.eventId, adminId, reason });
          break;
        case "exclude_agent":
          agentId = input.agentId;
          result = await service.setEpochExclusion(deps, { ...input, adminId, reason });
          break;
        case "exclude_fee":
          await service.setFeeExcluded(deps, {
            feeId: input.feeId,
            exclude: input.exclude,
            adminId,
            reason,
          });
          break;
        case "create_batch":
          result = (
            await payouts.createPayoutBatch(deps, settings, {
              epochId: input.epochId,
              adminId,
              reason,
            })
          ).batchId;
          break;
        case "submit_signature":
          result = await payouts.submitPayoutSignature(deps, settings, signatureCrypto, {
            payoutIds: input.payoutIds,
            signature: input.signature,
            adminId,
            reason,
          });
          break;
        case "reconcile":
          result = { confirmed: await payouts.reconcilePayouts(deps, settings) };
          break;
        case "release_payout":
          await payouts.releasePayout(deps, { payoutId: input.payoutId, adminId, reason });
          break;
        case "cancel_batch":
          await payouts.cancelPayoutBatch(deps, { batchId: input.batchId, adminId, reason });
          break;
      }
      await mirrorToAdminLog(
        admin,
        adminId,
        agentId,
        `rewards.${input.action}`,
        reason,
        input.action === "submit_signature"
          ? { payoutIds: input.payoutIds }
          : { action: input.action },
      );
      return {
        success: true as const,
        message: "Done. The action was recorded in the audit log.",
        result: plain(result),
      };
    } catch (error) {
      return failed(error);
    }
  });
