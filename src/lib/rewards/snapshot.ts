// The public projection of the reward system. Built by the scheduler and stored
// in reward_pool_state.public_snapshot, so a public page view is a single read:
// it never triggers an RPC call or a heavy aggregation.
//
// Only deliberately public facts are copied here: usernames, names, Karma,
// amounts, epoch totals, the pool address and confirmed payout signatures.
// Never: tokens, nonces, admin notes, fraud flags, wallet verification
// metadata, rejected events or private reasons.

import { formatSol, solscanAccountUrl, solscanTxUrl, type EffectiveRewardSettings } from "./config";
import { nextDistributionAt } from "./epochs";
import type { RewardDeps } from "./ports";
import { publicWalletLabel } from "./wallet";

export const PUBLIC_EXPLANATION =
  "Karma is an internal reputation score, not a token and not a fixed promise of payment. Rewards vary according to verified fee income and eligible participation.";

export const PILOT_LABEL = "Platform Agent";
export const PILOT_SUBLABEL = "Participates in the Karma Rewards pilot";

export type PublicRewardStatus =
  "estimated" | "no_verified_wallet" | "below_minimum" | "not_participating";

export type PublicLeaderboardEntry = {
  rank: number;
  username: string;
  name: string;
  daily_karma: string;
  lifetime_karma: string;
  estimated_reward_lamports: string;
  estimated_reward_sol: string;
  reward_status: PublicRewardStatus;
  reward_mode: "pilot" | "public" | "karma_only" | "disabled";
  is_pilot: boolean;
  pilot_wallet_note: string | null;
};

export type PublicDistribution = {
  epoch_key: string;
  starts_at: string;
  ends_at: string;
  state: string;
  fee_income_lamports: string;
  reward_pool_lamports: string;
  payable_lamports: string;
  retained_lamports: string;
  eligible_agent_count: number;
  rewards: {
    username: string;
    name: string;
    is_pilot: boolean;
    final_reward_lamports: string;
    final_reward_sol: string;
    paid: boolean;
    tx_signature: string | null;
    explorer_url: string | null;
  }[];
};

export type PublicSnapshot = {
  generated_at: string;
  enabled: boolean;
  distribution_enabled: boolean;
  network: string;
  explanation: string;
  pool: {
    address: string | null;
    explorer_url: string | null;
    balance_lamports: string | null;
    balance_sol: string | null;
    balance_checked_at: string | null;
  };
  current_epoch: null | {
    epoch_key: string;
    starts_at: string;
    ends_at: string;
    next_distribution_at: string;
    fees_received_lamports: string;
    fees_received_sol: string;
    agent_rewards_lamports: string;
    agent_rewards_sol: string;
    platform_treasury_lamports: string;
    platform_treasury_sol: string;
    distribution_bps: number;
    eligible_agent_count: number;
    total_daily_karma: string;
  };
  settings: {
    min_daily_karma: number;
    max_agent_share_bps: number;
    max_wallet_share_bps: number;
    min_payout_lamports: string;
    scoring: EffectiveRewardSettings["scoring"];
  };
  leaderboard: PublicLeaderboardEntry[];
  recent_epochs: {
    epoch_key: string;
    state: string;
    run_mode: string;
    reward_pool_lamports: string;
  }[];
  previous_distributions: PublicDistribution[];
};

const LEADERBOARD_SIZE = 500;

export async function buildPublicSnapshot(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
): Promise<PublicSnapshot> {
  // Imported lazily to avoid a module cycle with service.ts.
  const { computeEpochDistribution } = await import("./service");
  const now = deps.now();
  const [pool, epochs, wallets] = await Promise.all([
    deps.store.getPoolState(),
    deps.store.listEpochs({ limit: 30 }),
    deps.store.listCurrentWallets(),
  ]);
  const walletByAgent = new Map(wallets.map((w) => [w.agent_id, w]));
  const current = epochs.find(
    (e) =>
      e.state === "open" &&
      Date.parse(e.starts_at) <= now.getTime() &&
      now.getTime() < Date.parse(e.ends_at),
  );

  let leaderboard: PublicLeaderboardEntry[] = [];
  let currentEpoch: PublicSnapshot["current_epoch"] = null;
  if (current) {
    const result = await computeEpochDistribution(deps, settings, current);
    const agentById = new Map(result.agents.map((a) => [a.id, a]));
    const lifetime = await deps.store.lifetimeKarma(result.rows.map((r) => r.agent_id));
    leaderboard = [...result.rows]
      .sort((a, b) =>
        b.daily_karma > a.daily_karma
          ? 1
          : b.daily_karma < a.daily_karma
            ? -1
            : (agentById.get(a.agent_id)?.username ?? "").localeCompare(
                agentById.get(b.agent_id)?.username ?? "",
              ),
      )
      .filter((r) => agentById.has(r.agent_id))
      .slice(0, LEADERBOARD_SIZE)
      .map((r, index) => {
        const agent = agentById.get(r.agent_id)!;
        const estimate =
          r.status === "payable" || r.status === "carried_forward" ? r.gross_lamports : 0n;
        const status: PublicRewardStatus =
          r.status === "payable"
            ? "estimated"
            : r.status === "carried_forward"
              ? "below_minimum"
              : r.status === "retained" && r.ineligibility_reason === "no_verified_wallet"
                ? "no_verified_wallet"
                : "not_participating";
        return {
          rank: index + 1,
          username: agent.username,
          name: agent.name,
          daily_karma: r.daily_karma.toString(),
          lifetime_karma: (lifetime.get(r.agent_id) ?? 0n).toString(),
          estimated_reward_lamports: estimate.toString(),
          estimated_reward_sol: formatSol(estimate),
          reward_status: status,
          reward_mode: r.reward_mode,
          is_pilot: r.reward_mode === "pilot",
          pilot_wallet_note:
            r.reward_mode === "pilot"
              ? publicWalletLabel(walletByAgent.get(r.agent_id)?.status)
              : null,
        };
      });
    const t = result.totals;
    currentEpoch = {
      epoch_key: current.epoch_key,
      starts_at: current.starts_at,
      ends_at: current.ends_at,
      next_distribution_at: nextDistributionAt(current.ends_at, settings.finalizationDelayHours),
      fees_received_lamports: t.fee_income_lamports.toString(),
      fees_received_sol: formatSol(t.fee_income_lamports),
      agent_rewards_lamports: t.reward_pool_lamports.toString(),
      agent_rewards_sol: formatSol(t.reward_pool_lamports),
      platform_treasury_lamports: t.treasury_lamports.toString(),
      platform_treasury_sol: formatSol(t.treasury_lamports),
      distribution_bps: settings.distributionBps,
      eligible_agent_count: t.eligible_agent_count,
      total_daily_karma: t.total_daily_karma.toString(),
    };
  }

  const finalized = epochs
    .filter((e) => e.state === "approved" || e.state === "paying" || e.state === "paid")
    .slice(0, 14);
  const agents = await deps.store.listAgents();
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const previous: PublicDistribution[] = [];
  for (const epoch of finalized) {
    const [allocations, payouts] = await Promise.all([
      deps.store.listAllocations(epoch.id),
      deps.store.listPayouts({ epochId: epoch.id, status: ["confirmed"] }),
    ]);
    const payoutByAllocation = new Map(payouts.map((p) => [p.allocation_id, p]));
    previous.push({
      epoch_key: epoch.epoch_key,
      starts_at: epoch.starts_at,
      ends_at: epoch.ends_at,
      state: epoch.state,
      fee_income_lamports: epoch.fee_income_lamports.toString(),
      reward_pool_lamports: epoch.reward_pool_lamports.toString(),
      payable_lamports: epoch.payable_lamports.toString(),
      retained_lamports: epoch.retained_lamports.toString(),
      eligible_agent_count: epoch.eligible_agent_count,
      rewards: allocations
        .filter((a) => (a.status === "payable" || a.status === "paid") && agentById.has(a.agent_id))
        .sort((a, b) =>
          b.payable_lamports > a.payable_lamports
            ? 1
            : b.payable_lamports < a.payable_lamports
              ? -1
              : 0,
        )
        .map((a) => {
          const agent = agentById.get(a.agent_id)!;
          const payout = payoutByAllocation.get(a.id);
          return {
            username: agent.username,
            name: agent.name,
            is_pilot: a.reward_mode === "pilot",
            final_reward_lamports: a.payable_lamports.toString(),
            final_reward_sol: formatSol(a.payable_lamports),
            paid: a.status === "paid" && Boolean(payout),
            tx_signature: payout?.tx_signature ?? null,
            explorer_url: payout?.tx_signature
              ? solscanTxUrl(payout.tx_signature, settings.network)
              : null,
          };
        }),
    });
  }

  const address = settings.poolWalletAddress;
  const balance = pool && pool.wallet_address === address ? pool.pool_balance_lamports : null;
  const snapshot: PublicSnapshot = {
    generated_at: now.toISOString(),
    enabled: settings.karmaEnabled,
    distribution_enabled: settings.distributionEnabled,
    network: settings.network,
    explanation: PUBLIC_EXPLANATION,
    pool: {
      address,
      explorer_url: address ? solscanAccountUrl(address, settings.network) : null,
      balance_lamports: balance === null || balance === undefined ? null : balance.toString(),
      balance_sol: balance === null || balance === undefined ? null : formatSol(balance),
      balance_checked_at:
        balance === null || balance === undefined ? null : (pool?.balance_checked_at ?? null),
    },
    current_epoch: currentEpoch,
    settings: {
      min_daily_karma: settings.minDailyKarma,
      max_agent_share_bps: settings.maxAgentShareBps,
      max_wallet_share_bps: settings.maxWalletShareBps,
      min_payout_lamports: settings.minPayoutLamports.toString(),
      scoring: settings.scoring,
    },
    leaderboard,
    recent_epochs: epochs.slice(0, 10).map((e) => ({
      epoch_key: e.epoch_key,
      state: e.state,
      run_mode: e.run_mode,
      reward_pool_lamports: e.reward_pool_lamports.toString(),
    })),
    previous_distributions: previous,
  };
  await deps.store.updatePoolState({
    public_snapshot: snapshot,
    public_snapshot_at: snapshot.generated_at,
  });
  return snapshot;
}

/** What the public endpoint returns while rewards are off or not yet built. */
export function disabledSnapshot(
  network: string,
): Pick<PublicSnapshot, "enabled" | "explanation" | "network"> & { message: string } {
  return {
    enabled: false,
    network,
    explanation: PUBLIC_EXPLANATION,
    message: "Karma Rewards are not active yet.",
  };
}
