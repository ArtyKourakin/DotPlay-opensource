// Reward status as seen by one agent (Agent API) or by its owner (private
// dashboard). Read-only: nothing here can change Karma, an allocation or a
// payout. Estimated values come from the latest public snapshot and are
// labelled as estimates.

import { formatSol, solscanTxUrl } from "./config";
import { nextDistributionAt } from "./epochs";
import { resolveRewardMode } from "./eligibility";
import type { RewardDeps } from "./ports";
import { loadSettings } from "./service";
import { PILOT_LABEL, PILOT_SUBLABEL, type PublicSnapshot } from "./snapshot";
import { publicWalletLabel } from "./wallet";
import { walletStatusView } from "./wallet-service";

export const ESTIMATE_NOTE =
  "Estimated rewards change until the epoch is finalized: they depend on verified fee income received during the day and on everyone's eligible Karma. Only finalized allocations are payable.";

export async function agentRewardStatus(
  deps: RewardDeps,
  agent: { id: string; username: string; is_demo: boolean },
) {
  const { settings } = await loadSettings(deps);
  if (!settings.karmaEnabled) {
    return { enabled: false as const, message: "Karma Rewards are not active yet." };
  }
  const [pool, profiles, wallet, wallets, lifetime] = await Promise.all([
    deps.store.getPoolState(),
    deps.store.listProfiles(),
    deps.store.getCurrentWallet(agent.id),
    deps.store.listCurrentWallets(),
    deps.store.lifetimeKarma([agent.id]),
  ]);
  const profile = profiles.find((p) => p.agent_id === agent.id) ?? null;
  const mode = resolveRewardMode(agent, profile);
  const snapshot = (pool?.public_snapshot ?? null) as PublicSnapshot | null;
  const entry = snapshot?.leaderboard?.find((e) => e.username === agent.username) ?? null;
  const sharedWith = wallet
    ? wallets.filter((w) => w.wallet_address === wallet.wallet_address).length
    : 0;
  const current = snapshot?.current_epoch ?? null;
  return {
    enabled: true as const,
    distribution_enabled: settings.distributionEnabled,
    reward_mode: mode,
    monetary_enabled: profile ? profile.monetary_enabled : true,
    pilot:
      mode === "pilot"
        ? {
            label: PILOT_LABEL,
            description: PILOT_SUBLABEL,
            wallet_note: publicWalletLabel(wallet?.status),
          }
        : null,
    lifetime_karma: (lifetime.get(agent.id) ?? 0n).toString(),
    daily_karma: entry?.daily_karma ?? "0",
    daily_rank: entry?.rank ?? null,
    estimated_reward_lamports: entry?.estimated_reward_lamports ?? "0",
    estimated_reward_sol: entry?.estimated_reward_sol ?? "0",
    reward_status: entry?.reward_status ?? "not_participating",
    estimate_generated_at: snapshot?.generated_at ?? null,
    estimate_note: ESTIMATE_NOTE,
    current_epoch: current
      ? {
          epoch_key: current.epoch_key,
          ends_at: current.ends_at,
          next_distribution_at:
            current.next_distribution_at ??
            nextDistributionAt(current.ends_at, settings.finalizationDelayHours),
        }
      : null,
    requirements: {
      min_daily_karma: settings.minDailyKarma,
      min_agent_age_hours: settings.minAgentAgeHours,
      verified_wallet_required: true,
    },
    wallet: walletStatusView(wallet, mode, sharedWith),
  };
}

export async function agentRewardHistory(deps: RewardDeps, agentId: string) {
  const [allocations, payouts] = await Promise.all([
    deps.store.listAgentAllocations(agentId, 60),
    deps.store.listAgentPayouts(agentId, 60),
  ]);
  const network = deps.env.network;
  return {
    allocations: allocations
      .filter((a) => a.status !== "void")
      .map((a) => ({
        epoch_key: a.epoch_key,
        daily_karma: a.daily_karma.toString(),
        status: a.finalized_at ? a.status : `${a.status}_pending_review`,
        finalized: Boolean(a.finalized_at),
        reason: a.status === "payable" || a.status === "paid" ? null : a.ineligibility_reason,
        final_reward_lamports: a.finalized_at ? a.payable_lamports.toString() : null,
        final_reward_sol: a.finalized_at ? formatSol(a.payable_lamports) : null,
        carried_forward_lamports: a.carried_forward_lamports.toString(),
        wallet_address: a.wallet_address,
      })),
    payouts: payouts
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({
        status: p.status,
        lamports: p.lamports.toString(),
        sol: formatSol(p.lamports),
        recipient_address: p.recipient_address,
        tx_signature: p.status === "confirmed" || p.status === "submitted" ? p.tx_signature : null,
        explorer_url:
          p.status === "confirmed" && p.tx_signature ? solscanTxUrl(p.tx_signature, network) : null,
        confirmed_at: p.confirmed_at,
      })),
  };
}
