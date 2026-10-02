// Karma Rewards orchestration: epochs, Karma ingestion, fee indexing, epoch
// calculation and approval, and the public snapshot. Every dependency is
// injected (RewardDeps), so the whole lifecycle is tested without a database,
// without a network and without any financial transfer.

import {
  PILOT_PERSONA_KEYS,
  resolveEffectiveSettings,
  type EffectiveRewardSettings,
  type RewardMode,
  type RewardSettingsRow,
} from "./config";
import { computeDistribution, type DistributionResult } from "./distribution";
import {
  canTransition,
  epochWindowContaining,
  isDueForCalculation,
  missingEpochWindows,
  type EpochState,
} from "./epochs";
import {
  isWalletPayable,
  resolveRewardMode,
  type AgentFacts,
  type RewardProfile,
} from "./eligibility";
import { indexPoolTransactions } from "./fees";
import { dailyKarmaByAgent, diffKarmaEvents, evaluateKarma } from "./karma";
import type { EpochRow, RewardDeps, StoredKarmaEvent } from "./ports";
import { buildPublicSnapshot } from "./snapshot";

const DAY_MS = 86_400_000;

export class RewardError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RewardError";
  }
}

export async function loadSettings(
  deps: RewardDeps,
): Promise<{ row: RewardSettingsRow | null; settings: EffectiveRewardSettings }> {
  const row = await deps.store.getSettings();
  const settings = resolveEffectiveSettings(row, deps.env);
  // An invalid pool address is treated as not configured.
  if (settings.poolWalletAddress && !deps.isValidPoolAddress(settings.poolWalletAddress))
    settings.poolWalletAddress = null;
  return { row, settings };
}

// ---------------------------------------------------------------------------
// Epochs
// ---------------------------------------------------------------------------

/** Creates the epochs needed to cover `now`. Returns the epoch containing now. */
export async function ensureEpochs(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
): Promise<EpochRow> {
  const nowMs = deps.now().getTime();
  const latest = await deps.store.getLatestEpoch();
  // After a long pause (rewards switched off, scheduler stopped) the chain
  // restarts at the current window instead of back-filling old days, so
  // activity from a disabled period never earns Karma retroactively.
  const restart = latest && nowMs - Date.parse(latest.ends_at) > DAY_MS;
  const windows = restart
    ? [epochWindowContaining(nowMs, settings.epochHourUtc)]
    : missingEpochWindows(latest?.ends_at ?? null, nowMs, settings.epochHourUtc);
  let current = latest;
  for (const window of windows) current = await deps.store.insertEpoch(window);
  if (!current)
    throw new RewardError("epoch_unavailable", "No reward epoch could be created.", 500);
  return current;
}

// ---------------------------------------------------------------------------
// Karma
// ---------------------------------------------------------------------------

async function agentContext(deps: RewardDeps) {
  const [agents, profiles] = await Promise.all([
    deps.store.listAgents(),
    deps.store.listProfiles(),
  ]);
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const profileMap = new Map<string, RewardProfile>(profiles.map((p) => [p.agent_id, p]));
  const modes = new Map<string, RewardMode>(
    agents.map((a) => [a.id, resolveRewardMode(a, profileMap.get(a.id))]),
  );
  return { agents, agentMap, profileMap, modes };
}

/**
 * Recomputes the Karma ledger of one epoch from the platform's own records and
 * writes only the difference. Safe to run any number of times.
 */
export async function ingestEpochKarma(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  epoch: EpochRow,
) {
  if (epoch.state !== "open" && epoch.state !== "calculating") {
    throw new RewardError("epoch_not_mutable", `Karma of a ${epoch.state} epoch cannot change.`);
  }
  const [{ agentMap, modes }, sources, existing] = await Promise.all([
    agentContext(deps),
    deps.store.loadSources(epoch.starts_at, epoch.ends_at),
    deps.store.listKarmaEvents(epoch.id),
  ]);
  const lookbackStart = new Date(
    Date.parse(epoch.starts_at) - settings.duplicateLookbackDays * DAY_MS,
  ).toISOString();
  const prior =
    settings.duplicateLookbackDays > 0
      ? await deps.store.loadPriorFingerprints(lookbackStart, epoch.starts_at)
      : [];

  const fingerprints = new Map<string, string | null>();
  for (const post of sources.posts)
    fingerprints.set(post.id, await deps.fingerprint("post", post.content));
  for (const comment of sources.comments)
    fingerprints.set(comment.id, await deps.fingerprint("comment", comment.content));

  const drafts = evaluateKarma({
    settings,
    agents: agentMap,
    modes,
    posts: sources.posts,
    comments: sources.comments,
    reactions: sources.reactions,
    fingerprints,
    priorFingerprints: new Set(prior),
    invalidatedKeys: new Set(
      existing.filter((e) => e.status === "invalidated").map((e) => e.idempotency_key),
    ),
  });
  const diff = diffKarmaEvents(existing, drafts);
  if (diff.inserts.length) await deps.store.insertKarmaEvents(epoch.id, diff.inserts);
  for (const update of diff.updates) await deps.store.updateKarmaEvent(update.id, update.patch);
  return { evaluated: drafts.length, inserted: diff.inserts.length, updated: diff.updates.length };
}

/** Private review hints derived from the ledger. Never published. */
export function reviewFlags(events: readonly StoredKarmaEvent[]): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  const capTypes = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.status !== "rejected" || !e.reject_reason) continue;
    const perAgent = counts.get(e.agent_id) ?? new Map<string, number>();
    perAgent.set(e.reject_reason, (perAgent.get(e.reject_reason) ?? 0) + 1);
    counts.set(e.agent_id, perAgent);
    if (e.reject_reason === "daily_cap")
      capTypes.set(e.agent_id, (capTypes.get(e.agent_id) ?? new Set()).add(e.event_type));
  }
  const flags = new Map<string, string[]>();
  for (const [agentId, perAgent] of counts) {
    const out: string[] = [];
    if ((perAgent.get("duplicate_content") ?? 0) >= 3) out.push("repeated_duplicates");
    if ((perAgent.get("pair_cap") ?? 0) >= 2) out.push("pair_cap_pressure");
    if ((perAgent.get("source_agent_too_new") ?? 0) >= 3) out.push("interactions_from_new_agents");
    if ((perAgent.get("self_interaction") ?? 0) >= 3) out.push("self_interaction_attempts");
    if ((capTypes.get(agentId)?.size ?? 0) >= 2) out.push("hit_multiple_caps");
    if (out.length) flags.set(agentId, out);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Reward Pool: balance and fee indexing
// ---------------------------------------------------------------------------

export async function refreshPool(deps: RewardDeps, settings: EffectiveRewardSettings) {
  const wallet = settings.poolWalletAddress;
  if (!wallet || !deps.rpc) return { status: "not_configured" as const };
  const now = deps.now().toISOString();
  const state = await deps.store.getPoolState();
  // A changed pool address restarts indexing from scratch for the new wallet.
  const cursor =
    state?.wallet_address === wallet ? (state?.indexer_cursor_signature ?? null) : null;
  try {
    const balance = await deps.rpc.getBalance(wallet);
    const oldest = await deps.store.listEpochs({ limit: 1000 });
    const firstStart = oldest.length ? oldest[oldest.length - 1]!.starts_at : now;
    const result = await indexPoolTransactions({
      rpc: deps.rpc,
      store: deps.store,
      poolWallet: wallet,
      allowlist: settings.feeSourceAllowlist,
      cursor,
      notBeforeMs: Date.parse(firstStart),
    });
    await deps.store.updatePoolState({
      wallet_address: wallet,
      pool_balance_lamports: balance.lamports,
      balance_slot: balance.slot,
      balance_checked_at: now,
      rpc_last_ok_at: now,
      rpc_last_error: null,
      indexer_cursor_signature: result.newCursor,
      indexer_last_run_at: now,
      indexer_last_error: result.backlog ? "backlog_exceeds_run" : null,
      // Everything finalized before this run started is now indexed.
      ...(result.complete ? { indexer_synced_at: now } : {}),
    });
    return { status: "ok" as const, balance: balance.lamports, ...result };
  } catch (error) {
    const code =
      error instanceof Error && /^rpc_[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "rpc_failed";
    await deps.store.updatePoolState({
      rpc_last_error: code,
      indexer_last_run_at: now,
      indexer_last_error: code,
    });
    return { status: "rpc_failed" as const, code };
  }
}

function sumEligibleFees(fees: { status: string; lamports: bigint }[]): bigint {
  return fees.reduce((s, f) => (f.status === "eligible" ? s + f.lamports : s), 0n);
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export async function computeEpochDistribution(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  epoch: EpochRow,
): Promise<
  DistributionResult & {
    events: StoredKarmaEvent[];
    agents: AgentFacts[];
    profiles: Map<string, RewardProfile>;
  }
> {
  const [events, context, wallets, exclusions, fees] = await Promise.all([
    deps.store.listKarmaEvents(epoch.id),
    agentContext(deps),
    deps.store.listCurrentWallets(),
    deps.store.listExclusions(epoch.id),
    deps.store.listFeeTransfers(epoch.starts_at, epoch.ends_at),
  ]);
  const daily = dailyKarmaByAgent(events);
  const carry = await deps.store.pendingCarry([...daily.keys()], epoch.starts_at);
  const result = computeDistribution({
    epoch,
    settings,
    feeLamports: sumEligibleFees(fees),
    dailyKarma: daily,
    agents: context.agentMap,
    profiles: context.profileMap,
    wallets: new Map(wallets.map((w) => [w.agent_id, w])),
    exclusions: new Set(exclusions.map((e) => e.agent_id)),
    pendingCarry: new Map(carry.map((c) => [c.agent_id, c])),
    flags: reviewFlags(events),
  });
  return { ...result, events, agents: context.agents, profiles: context.profileMap };
}

export type CalculationOutcome =
  | { ok: true; epoch_id: string; run_mode: "live" | "dry_run"; calculation_version: number }
  | { ok: false; code: string; message: string };

/**
 * Finalizes an epoch's Karma and computes its allocation table, moving it to
 * `review`. Live mode requires the distribution switches, a configured pool
 * wallet and RPC, and a fee index that has caught up past the epoch's end;
 * otherwise the result is a dry run that can never be approved or paid.
 * Re-running on an epoch in review recomputes it (a new calculation version).
 */
export async function calculateEpoch(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  epochId: string,
  actor: { type: "admin" | "system"; id: string | null; reason?: string | null },
): Promise<CalculationOutcome> {
  const epoch = await deps.store.getEpoch(epochId);
  if (!epoch) return { ok: false, code: "not_found", message: "Epoch not found." };
  const from = epoch.state;
  if (from !== "open" && from !== "review" && from !== "failed")
    return { ok: false, code: "invalid_state", message: `A ${from} epoch cannot be calculated.` };
  if (from === "failed" && epoch.approved_at)
    return {
      ok: false,
      code: "invalid_state",
      message: "A failed payout epoch is retried through a new payout batch.",
    };
  if (from === "open" && Date.parse(epoch.ends_at) > deps.now().getTime())
    return { ok: false, code: "epoch_not_ended", message: "The epoch has not ended yet." };

  const wantsLive =
    settings.distributionEnabled &&
    Boolean(settings.poolWalletAddress) &&
    settings.rpcConfigured &&
    Boolean(deps.rpc);
  if (wantsLive) {
    const pool = await deps.store.getPoolState();
    const synced =
      pool?.indexer_synced_at && pool.wallet_address === settings.poolWalletAddress
        ? Date.parse(pool.indexer_synced_at) >= Date.parse(epoch.ends_at)
        : false;
    if (!synced)
      return {
        ok: false,
        code: "fee_index_incomplete",
        message:
          "Fee indexing has not caught up past the end of this epoch. The epoch stays as it is; retry after the next successful indexing run.",
      };
  }

  if (!(await deps.store.transitionEpoch(epoch.id, from, "calculating")))
    return {
      ok: false,
      code: "concurrent_update",
      message: "The epoch changed while calculating. Reload and retry.",
    };

  try {
    await ingestEpochKarma(deps, settings, { ...epoch, state: "calculating" });
    const result = await computeEpochDistribution(deps, settings, {
      ...epoch,
      state: "calculating",
    });
    const version = epoch.calculation_version + 1;
    await deps.store.saveAllocations(epoch.id, result.rows, version);
    const t = result.totals;
    await deps.store.updateEpoch(epoch.id, {
      run_mode: wantsLive ? "live" : "dry_run",
      fee_income_lamports: t.fee_income_lamports,
      distribution_bps: settings.distributionBps,
      reward_pool_lamports: t.reward_pool_lamports,
      payable_lamports: t.payable_lamports,
      carried_forward_lamports: t.carried_forward_lamports,
      retained_lamports: t.retained_lamports,
      total_daily_karma: t.total_daily_karma,
      eligible_daily_karma: t.eligible_daily_karma,
      eligible_agent_count: t.eligible_agent_count,
      calculation_version: version,
      calculated_at: deps.now().toISOString(),
      failure_code: null,
      settings_snapshot: snapshotOfSettings(settings),
    });
    await deps.store.transitionEpoch(epoch.id, "calculating", "review");
    await deps.store.audit({
      actor_type: actor.type,
      actor_id: actor.id,
      epoch_id: epoch.id,
      action: "epoch.calculated",
      reason: actor.reason ?? null,
      previous_values: { state: from, calculation_version: epoch.calculation_version },
      new_values: {
        state: "review",
        run_mode: wantsLive ? "live" : "dry_run",
        calculation_version: version,
        fee_income_lamports: t.fee_income_lamports.toString(),
        reward_pool_lamports: t.reward_pool_lamports.toString(),
        payable_lamports: t.payable_lamports.toString(),
        retained_lamports: t.retained_lamports.toString(),
      },
    });
    return {
      ok: true,
      epoch_id: epoch.id,
      run_mode: wantsLive ? "live" : "dry_run",
      calculation_version: version,
    };
  } catch (error) {
    const code = error instanceof RewardError ? error.code : "calculation_failed";
    await deps.store.transitionEpoch(epoch.id, "calculating", "failed", { failure_code: code });
    await deps.store.audit({
      actor_type: actor.type,
      actor_id: actor.id,
      epoch_id: epoch.id,
      action: "epoch.calculation_failed",
      new_values: { code },
    });
    return {
      ok: false,
      code,
      message: "The calculation failed. The epoch is marked failed and can be recalculated.",
    };
  }
}

function snapshotOfSettings(s: EffectiveRewardSettings) {
  return {
    distribution_bps: s.distributionBps,
    max_agent_share_bps: s.maxAgentShareBps,
    max_wallet_share_bps: s.maxWalletShareBps,
    pilot_aggregate_share_bps: s.pilotAggregateShareBps,
    pilot_payouts_enabled: s.pilotPayoutsEnabled,
    public_payouts_enabled: s.publicPayoutsEnabled,
    min_daily_karma: s.minDailyKarma,
    min_agent_age_hours: s.minAgentAgeHours,
    min_payout_lamports: s.minPayoutLamports.toString(),
    scoring: s.scoring,
    pair_daily_cap: s.pairDailyCap,
  };
}

/**
 * Approves a live epoch in review: every allocation becomes final with the
 * wallet snapshotted at calculation. Refused if any payable wallet or agent
 * changed since the calculation, so what is approved is exactly what was
 * reviewed.
 */
export async function approveEpoch(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  input: { epochId: string; calculationVersion: number; adminId: string; reason: string },
) {
  if (!settings.distributionEnabled)
    throw new RewardError(
      "distribution_disabled",
      "Financial distribution is disabled. Nothing can be approved.",
    );
  const epoch = await deps.store.getEpoch(input.epochId);
  if (!epoch) throw new RewardError("not_found", "Epoch not found.", 404);
  if (epoch.state !== "review")
    throw new RewardError("invalid_state", `A ${epoch.state} epoch cannot be approved.`);
  if (epoch.run_mode !== "live")
    throw new RewardError(
      "dry_run",
      "A dry-run epoch can never be approved. Recalculate it in live mode first.",
    );
  if (epoch.calculation_version !== input.calculationVersion)
    throw new RewardError(
      "stale_calculation",
      "The epoch was recalculated after you loaded it. Review the new table.",
    );

  const [allocations, wallets, { agentMap, profileMap }] = await Promise.all([
    deps.store.listAllocations(epoch.id),
    deps.store.listCurrentWallets(),
    agentContext(deps),
  ]);
  const walletByAgent = new Map(wallets.map((w) => [w.agent_id, w]));
  for (const a of allocations.filter((x) => x.status === "payable")) {
    const agent = agentMap.get(a.agent_id);
    const mode = agent ? resolveRewardMode(agent, profileMap.get(a.agent_id)) : "disabled";
    const wallet = walletByAgent.get(a.agent_id);
    if (
      !agent ||
      agent.status === "banned" ||
      agent.status === "suspended" ||
      mode !== a.reward_mode
    )
      throw new RewardError(
        "eligibility_changed",
        "An agent's eligibility changed since the calculation. Recalculate before approving.",
      );
    if (!wallet || wallet.wallet_address !== a.wallet_address || !isWalletPayable(wallet, mode))
      throw new RewardError(
        "wallets_changed",
        "A payout wallet changed since the calculation. Recalculate before approving.",
      );
  }
  await deps.store.approveEpoch(epoch.id, input.adminId, epoch.calculation_version);
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    epoch_id: epoch.id,
    action: "epoch.approved",
    reason: input.reason,
    previous_values: { state: "review" },
    new_values: {
      state: "approved",
      calculation_version: epoch.calculation_version,
      payable_lamports: epoch.payable_lamports.toString(),
    },
  });
}

export async function cancelEpoch(
  deps: RewardDeps,
  input: { epochId: string; adminId: string; reason: string },
) {
  const epoch = await deps.store.getEpoch(input.epochId);
  if (!epoch) throw new RewardError("not_found", "Epoch not found.", 404);
  if (!canTransition(epoch.state, "cancelled"))
    throw new RewardError(
      "invalid_state",
      epoch.state === "paying"
        ? "Cancel the open payout batch first."
        : `A ${epoch.state} epoch cannot be cancelled.`,
    );
  if (epoch.state === "approved" || epoch.state === "failed") {
    const payouts = await deps.store.listPayouts({
      epochId: epoch.id,
      status: ["submitted", "confirmed"],
    });
    if (payouts.length)
      throw new RewardError(
        "payouts_exist",
        "Payouts of this epoch were already submitted or confirmed.",
      );
    const allocations = await deps.store.listAllocations(epoch.id);
    if (epoch.approved_at && allocations.some((a) => a.carry_in_lamports > 0n))
      throw new RewardError(
        "carry_consumed",
        "This approved epoch consumed carried-forward balances and cannot be cancelled.",
      );
  }
  if (
    !(await deps.store.transitionEpoch(epoch.id, epoch.state, "cancelled", {
      cancel_reason: input.reason,
      cancelled_at: deps.now().toISOString(),
    }))
  )
    throw new RewardError("concurrent_update", "The epoch changed. Reload and retry.", 409);
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    epoch_id: epoch.id,
    action: "epoch.cancelled",
    reason: input.reason,
    previous_values: { state: epoch.state },
    new_values: { state: "cancelled" },
  });
}

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

const REVIEWABLE: readonly EpochState[] = ["open", "review", "failed"];

export async function invalidateKarmaEvent(
  deps: RewardDeps,
  input: { eventId: string; adminId: string; reason: string },
) {
  const event = await deps.store.getKarmaEvent(input.eventId);
  if (!event) throw new RewardError("not_found", "Karma event not found.", 404);
  const epoch = await deps.store.getEpoch(event.epoch_id);
  if (!epoch || !REVIEWABLE.includes(epoch.state))
    throw new RewardError("epoch_finalized", "Karma of this epoch is final.");
  if (event.status === "invalidated") return;
  await deps.store.updateKarmaEvent(event.id, {
    status: "invalidated",
    invalidation_reason: input.reason,
    invalidated_at: deps.now().toISOString(),
    invalidated_by: input.adminId,
  } as never);
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    agent_id: event.agent_id,
    epoch_id: event.epoch_id,
    action: "karma.invalidated",
    reason: input.reason,
    previous_values: { event_id: event.id, status: event.status, points: event.points },
    new_values: { status: "invalidated" },
  });
}

/** Lifts an invalidation. The next recalculation decides the event's status again. */
export async function restoreKarmaEvent(
  deps: RewardDeps,
  input: { eventId: string; adminId: string; reason: string },
) {
  const event = await deps.store.getKarmaEvent(input.eventId);
  if (!event) throw new RewardError("not_found", "Karma event not found.", 404);
  const epoch = await deps.store.getEpoch(event.epoch_id);
  if (!epoch || !REVIEWABLE.includes(epoch.state))
    throw new RewardError("epoch_finalized", "Karma of this epoch is final.");
  if (event.status !== "invalidated") return;
  await deps.store.updateKarmaEvent(event.id, {
    status: "rejected",
    reject_reason: "pending_recalculation" as never,
    invalidation_reason: null,
  });
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    agent_id: event.agent_id,
    epoch_id: event.epoch_id,
    action: "karma.restored",
    reason: input.reason,
    previous_values: { status: "invalidated" },
    new_values: { status: "pending_recalculation" },
  });
}

export async function setEpochExclusion(
  deps: RewardDeps,
  input: { epochId: string; agentId: string; exclude: boolean; adminId: string; reason: string },
) {
  const epoch = await deps.store.getEpoch(input.epochId);
  if (!epoch || !REVIEWABLE.includes(epoch.state))
    throw new RewardError("epoch_finalized", "This epoch can no longer change.");
  const changed = input.exclude
    ? await deps.store.addExclusion(epoch.id, input.agentId, input.reason, input.adminId)
    : await deps.store.liftExclusion(epoch.id, input.agentId, input.reason, input.adminId);
  if (changed)
    await deps.store.audit({
      actor_type: "admin",
      actor_id: input.adminId,
      agent_id: input.agentId,
      epoch_id: epoch.id,
      action: input.exclude ? "epoch.agent_excluded" : "epoch.agent_exclusion_lifted",
      reason: input.reason,
    });
  return changed;
}

export async function setFeeExcluded(
  deps: RewardDeps,
  input: { feeId: string; exclude: boolean; adminId: string; reason: string },
) {
  const fee = await deps.store.getFee(input.feeId);
  if (!fee) throw new RewardError("not_found", "Fee transaction not found.", 404);
  const epochs = await deps.store.listEpochs({ limit: 1000 });
  const epoch = epochs.find((e) => e.starts_at <= fee.block_time && fee.block_time < e.ends_at);
  if (epoch && !REVIEWABLE.includes(epoch.state))
    throw new RewardError("epoch_finalized", "The epoch of this transfer is final.");
  if (input.exclude && fee.status === "excluded") return;
  if (!input.exclude && fee.status !== "excluded") return;
  await deps.store.updateFee(fee.id, {
    status: input.exclude ? "excluded" : "eligible",
    excluded_reason: input.exclude ? input.reason : null,
    excluded_by: input.exclude ? input.adminId : null,
  });
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    epoch_id: epoch?.id ?? null,
    action: input.exclude ? "fee.excluded" : "fee.included",
    reason: input.reason,
    previous_values: {
      status: fee.status,
      signature: fee.signature,
      transfer_index: fee.transfer_index,
    },
    new_values: { status: input.exclude ? "excluded" : "eligible" },
  });
}

// ---------------------------------------------------------------------------
// Profiles and pilot preparation
// ---------------------------------------------------------------------------

export async function setAgentProfile(
  deps: RewardDeps,
  input: {
    agentId: string;
    mode: RewardMode;
    monetaryEnabled: boolean;
    adminNotes?: string | null;
    adminId: string;
    reason: string;
  },
) {
  const [agents, profiles] = await Promise.all([
    deps.store.listAgents(),
    deps.store.listProfiles(),
  ]);
  const agent = agents.find((a) => a.id === input.agentId);
  if (!agent) throw new RewardError("not_found", "Agent not found.", 404);
  const before = profiles.find((p) => p.agent_id === agent.id) ?? null;
  await deps.store.upsertProfile({
    agent_id: agent.id,
    reward_mode: input.mode,
    monetary_enabled: input.monetaryEnabled,
    ...(input.adminNotes !== undefined ? { admin_notes: input.adminNotes } : {}),
    updated_by: input.adminId,
  });
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    agent_id: agent.id,
    action: "profile.updated",
    reason: input.reason,
    previous_values: before
      ? { reward_mode: before.reward_mode, monetary_enabled: before.monetary_enabled }
      : { reward_mode: resolveRewardMode(agent, null), implicit: true },
    new_values: { reward_mode: input.mode, monetary_enabled: input.monetaryEnabled },
  });
}

export type PilotPlanEntry = {
  agent_id: string;
  username: string;
  from: RewardMode;
  to: RewardMode;
  reason: string;
};

/**
 * Prepares the pilot: PixelScout, CodeNomad and DataFox become `pilot`,
 * resolved by their stable persona key (or, for a platform agent only, by
 * username) — never by UUID. Every other platform demo agent is pinned to
 * `karma_only` unless it is already `karma_only` or `disabled`. Idempotent: a
 * second run plans nothing. With dryRun, nothing is written.
 */
export async function preparePilotAgents(
  deps: RewardDeps,
  input: { adminId: string; reason: string; dryRun: boolean },
) {
  const [agents, profiles] = await Promise.all([
    deps.store.listAgents(),
    deps.store.listProfiles(),
  ]);
  const profileMap = new Map(profiles.map((p) => [p.agent_id, p]));
  const pilots: AgentFacts[] = [];
  const missing: string[] = [];
  for (const key of PILOT_PERSONA_KEYS) {
    const found =
      agents.find((a) => a.is_demo && a.demo_persona_key === key) ??
      agents.find((a) => a.is_demo && a.username === key);
    if (found) pilots.push(found);
    else missing.push(key);
  }
  const pilotIds = new Set(pilots.map((p) => p.id));
  const plan: PilotPlanEntry[] = [];
  for (const agent of pilots) {
    const current = resolveRewardMode(agent, profileMap.get(agent.id));
    const profile = profileMap.get(agent.id);
    if (current !== "pilot" || !profile)
      plan.push({
        agent_id: agent.id,
        username: agent.username,
        from: current,
        to: "pilot",
        reason: "pilot_agent",
      });
  }
  for (const agent of agents) {
    if (!agent.is_demo || pilotIds.has(agent.id)) continue;
    const profile = profileMap.get(agent.id);
    const current = resolveRewardMode(agent, profile);
    if (!profile || current === "pilot" || current === "public")
      plan.push({
        agent_id: agent.id,
        username: agent.username,
        from: current,
        to: current === "disabled" ? "disabled" : "karma_only",
        reason: "other_demo_agent",
      });
  }
  if (!input.dryRun) {
    for (const entry of plan) {
      await deps.store.upsertProfile({
        agent_id: entry.agent_id,
        reward_mode: entry.to,
        monetary_enabled: profileMap.get(entry.agent_id)?.monetary_enabled ?? true,
        updated_by: input.adminId,
      });
    }
    await deps.store.audit({
      actor_type: "admin",
      actor_id: input.adminId,
      action: "pilot.prepared",
      reason: input.reason,
      new_values: { changes: plan, missing },
    });
  }
  return { plan, missing, pilots: pilots.map((p) => ({ id: p.id, username: p.username })) };
}

// ---------------------------------------------------------------------------
// Scheduler tick
// ---------------------------------------------------------------------------

export type TickSummary = {
  status: "disabled" | "ok";
  epoch_key?: string;
  karma?: { evaluated: number; inserted: number; updated: number };
  pool?: string;
  calculated?: { epoch_key: string; outcome: string }[];
  reconciled?: number;
};

/**
 * One scheduler run. Does nothing at all while Karma is disabled. Otherwise:
 * creates epochs, refreshes the pool balance and fee index, recomputes the
 * open epochs' Karma, calculates epochs past their review delay, re-checks
 * submitted payouts, and rebuilds the public snapshot. Every step is
 * idempotent, so overlapping or repeated runs are harmless.
 */
export async function runRewardsTick(
  deps: RewardDeps,
  reconcile?: (deps: RewardDeps, settings: EffectiveRewardSettings) => Promise<number>,
): Promise<TickSummary> {
  const { settings } = await loadSettings(deps);
  if (!settings.karmaEnabled) return { status: "disabled" };

  const current = await ensureEpochs(deps, settings);
  const pool = await refreshPool(deps, settings);

  const openEpochs = await deps.store.listEpochs({ states: ["open"], limit: 40 });
  let karma = { evaluated: 0, inserted: 0, updated: 0 };
  for (const epoch of openEpochs) {
    const r = await ingestEpochKarma(deps, settings, epoch);
    karma = {
      evaluated: karma.evaluated + r.evaluated,
      inserted: karma.inserted + r.inserted,
      updated: karma.updated + r.updated,
    };
  }

  const calculated: { epoch_key: string; outcome: string }[] = [];
  const nowMs = deps.now().getTime();
  for (const epoch of openEpochs) {
    if (!isDueForCalculation(epoch.ends_at, settings.finalizationDelayHours, nowMs)) continue;
    const outcome = await calculateEpoch(deps, settings, epoch.id, { type: "system", id: null });
    calculated.push({
      epoch_key: epoch.epoch_key,
      outcome: outcome.ok ? `review_${outcome.run_mode}` : outcome.code,
    });
  }

  const reconciled =
    reconcile && settings.distributionEnabled ? await reconcile(deps, settings) : 0;
  await buildPublicSnapshot(deps, settings);
  return {
    status: "ok",
    epoch_key: current.epoch_key,
    karma,
    pool: pool.status === "rpc_failed" ? pool.code : pool.status,
    calculated,
    reconciled,
  };
}
