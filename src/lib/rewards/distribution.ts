// Builds the allocation table of one epoch from its Daily Karma, the fee
// income, each agent's eligibility and payout wallet, and pending
// carry-forward balances. Pure and deterministic; used for the live estimate,
// the admin preview and the actual epoch calculation alike.

import type { EffectiveRewardSettings, RewardMode } from "./config";
import { allocateRewardPool, rewardPoolFromFees, type CapKind } from "./allocation";
import type {
  AgentFacts,
  IneligibleReason,
  PayoutWallet,
  RetainReason,
  RewardProfile,
} from "./eligibility";
import { decideParticipation, resolveRewardMode } from "./eligibility";

export type PendingCarry = { allocation_id: string; agent_id: string; lamports: bigint };

export type AllocationRowDraft = {
  agent_id: string;
  daily_karma: bigint;
  reward_mode: RewardMode;
  status: "ineligible" | "retained" | "carried_forward" | "payable";
  ineligibility_reason: IneligibleReason | RetainReason | "below_min_payout" | null;
  gross_lamports: bigint;
  carry_in_lamports: bigint;
  carry_source_allocation_id: string | null;
  payable_lamports: bigint;
  carried_forward_lamports: bigint;
  retained_lamports: bigint;
  capped_by: CapKind | null;
  wallet_address: string | null;
  wallet_status: string | null;
  wallet_method: string | null;
  flags: string[];
};

export type DistributionInput = {
  epoch: { starts_at: string; ends_at: string };
  settings: Pick<
    EffectiveRewardSettings,
    | "distributionBps"
    | "maxAgentShareBps"
    | "maxWalletShareBps"
    | "pilotAggregateShareBps"
    | "pilotPayoutsEnabled"
    | "publicPayoutsEnabled"
    | "minAgentAgeHours"
    | "minDailyKarma"
    | "minPayoutLamports"
  >;
  feeLamports: bigint;
  dailyKarma: ReadonlyMap<string, bigint>;
  agents: ReadonlyMap<string, AgentFacts>;
  profiles: ReadonlyMap<string, RewardProfile>;
  /** Current wallet of each agent (is_current rows only). */
  wallets: ReadonlyMap<string, PayoutWallet>;
  exclusions: ReadonlySet<string>;
  pendingCarry: ReadonlyMap<string, PendingCarry>;
  /** Private review hints per agent, e.g. from the Karma evaluation. */
  flags?: ReadonlyMap<string, string[]>;
};

export type DistributionTotals = {
  fee_income_lamports: bigint;
  treasury_lamports: bigint;
  reward_pool_lamports: bigint;
  gross_allocated_lamports: bigint;
  payable_lamports: bigint;
  carried_forward_lamports: bigint;
  carry_in_consumed_lamports: bigint;
  retained_lamports: bigint;
  unallocated_lamports: bigint;
  total_daily_karma: bigint;
  eligible_daily_karma: bigint;
  eligible_agent_count: number;
  payable_agent_count: number;
};

export type DistributionResult = { rows: AllocationRowDraft[]; totals: DistributionTotals };

export function computeDistribution(input: DistributionInput): DistributionResult {
  const { settings } = input;
  const pool = rewardPoolFromFees(input.feeLamports, settings.distributionBps);
  const agentIds = [...input.dailyKarma.entries()]
    .filter(([, k]) => k > 0n)
    .map(([id]) => id)
    .sort();

  // Shared payout wallets, for the review flag.
  const walletUse = new Map<string, number>();
  for (const w of input.wallets.values())
    walletUse.set(w.wallet_address, (walletUse.get(w.wallet_address) ?? 0) + 1);

  type Decided = {
    id: string;
    karma: bigint;
    mode: RewardMode;
    wallet: PayoutWallet | undefined;
    decision: ReturnType<typeof decideParticipation>;
  };
  const decided: Decided[] = agentIds.map((id) => {
    const agent = input.agents.get(id);
    const profile = input.profiles.get(id);
    const mode = agent ? resolveRewardMode(agent, profile) : "disabled";
    const wallet = input.wallets.get(id);
    const karma = input.dailyKarma.get(id) ?? 0n;
    return {
      id,
      karma,
      mode,
      wallet,
      decision: decideParticipation({
        agent,
        mode,
        monetaryEnabled: profile ? profile.monetary_enabled !== false : true,
        wallet,
        dailyKarma: karma,
        excluded: input.exclusions.has(id),
        epochEndsAt: input.epoch.ends_at,
        settings,
      }),
    };
  });

  const participants = decided.filter((d) => d.decision.participant);
  const result = allocateRewardPool(
    pool,
    participants.map((d) => ({
      agentId: d.id,
      karma: d.karma,
      // Only a payable wallet forms a wallet group; a retained share has no wallet.
      walletKey:
        d.decision.participant && d.decision.payable && d.wallet ? d.wallet.wallet_address : null,
      isPilot: d.mode === "pilot",
    })),
    {
      maxAgentShareBps: settings.maxAgentShareBps,
      maxWalletShareBps: settings.maxWalletShareBps,
      pilotAggregateShareBps: settings.pilotAggregateShareBps,
    },
  );

  const rows: AllocationRowDraft[] = [];
  let payable = 0n;
  let carriedForward = 0n;
  let carryConsumed = 0n;
  let retainedShares = 0n;
  let payableCount = 0;

  for (const d of decided) {
    const flags = [...(input.flags?.get(d.id) ?? [])];
    if (d.wallet && (walletUse.get(d.wallet.wallet_address) ?? 0) > 1) flags.push("shared_wallet");
    if (d.wallet?.status === "admin_verified_pilot") flags.push("admin_pilot_wallet");
    const base = {
      agent_id: d.id,
      daily_karma: d.karma,
      reward_mode: d.mode,
      carry_in_lamports: 0n,
      carry_source_allocation_id: null as string | null,
      wallet_address: d.wallet?.wallet_address ?? null,
      wallet_status: d.wallet?.status ?? null,
      wallet_method: d.wallet?.verification_method ?? null,
      capped_by: null as CapKind | null,
    };
    if (!d.decision.participant) {
      rows.push({
        ...base,
        status: "ineligible",
        ineligibility_reason: d.decision.reason,
        gross_lamports: 0n,
        payable_lamports: 0n,
        carried_forward_lamports: 0n,
        retained_lamports: 0n,
        flags,
      });
      continue;
    }
    const gross = result.amounts.get(d.id) ?? 0n;
    const capped = result.cappedBy.get(d.id) ?? null;
    if (capped) flags.push(`capped_${capped}`);
    if (!d.decision.payable) {
      retainedShares += gross;
      rows.push({
        ...base,
        capped_by: capped,
        status: "retained",
        ineligibility_reason: d.decision.retainReason,
        gross_lamports: gross,
        payable_lamports: 0n,
        carried_forward_lamports: 0n,
        retained_lamports: gross,
        flags,
      });
      continue;
    }
    const carry = input.pendingCarry.get(d.id);
    const carryIn = carry ? carry.lamports : 0n;
    const total = gross + carryIn;
    const meetsMinimum = total > 0n && total >= settings.minPayoutLamports;
    if (carry) carryConsumed += carryIn;
    if (meetsMinimum) {
      payable += total;
      payableCount += 1;
    } else {
      carriedForward += total;
    }
    rows.push({
      ...base,
      capped_by: capped,
      carry_in_lamports: carryIn,
      carry_source_allocation_id: carry ? carry.allocation_id : null,
      status: meetsMinimum ? "payable" : "carried_forward",
      ineligibility_reason: meetsMinimum ? null : "below_min_payout",
      gross_lamports: gross,
      payable_lamports: meetsMinimum ? total : 0n,
      carried_forward_lamports: meetsMinimum ? 0n : total,
      retained_lamports: 0n,
      flags,
    });
  }

  const eligibleKarma = participants.reduce((s, d) => s + d.karma, 0n);
  const totalKarma = decided.reduce((s, d) => s + d.karma, 0n);
  return {
    rows,
    totals: {
      fee_income_lamports: input.feeLamports > 0n ? input.feeLamports : 0n,
      treasury_lamports: (input.feeLamports > 0n ? input.feeLamports : 0n) - pool,
      reward_pool_lamports: pool,
      gross_allocated_lamports: result.allocated,
      payable_lamports: payable,
      carried_forward_lamports: carriedForward,
      carry_in_consumed_lamports: carryConsumed,
      // Retained = shares of participants that cannot be paid + everything the
      // caps and the rounding could not place. It stays in the Reward Pool.
      retained_lamports: retainedShares + result.remainder,
      unallocated_lamports: result.remainder,
      total_daily_karma: totalKarma,
      eligible_daily_karma: eligibleKarma,
      eligible_agent_count: participants.length,
      payable_agent_count: payableCount,
    },
  };
}
