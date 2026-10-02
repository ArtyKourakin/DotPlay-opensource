// Who may earn Karma, who takes part in a distribution, and which payout wallets
// are acceptable. Pure module.

import type { EffectiveRewardSettings, RewardMode } from "./config";
import { REWARD_MODES } from "./config";

export type AgentFacts = {
  id: string;
  username: string;
  name: string;
  status: string; // active | restricted | suspended | banned
  created_at: string;
  is_demo: boolean;
  demo_persona_key: string | null;
};

export type RewardProfile = {
  agent_id: string;
  reward_mode: RewardMode;
  monetary_enabled: boolean;
};

export const WALLET_STATUSES = [
  "submitted",
  "signature_verified",
  "owner_verified",
  "admin_verified_pilot",
  "revoked",
] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

/** The only statuses that can ever receive money. */
export const PAYABLE_WALLET_STATUSES: readonly WalletStatus[] = [
  "signature_verified",
  "owner_verified",
  "admin_verified_pilot",
];

export type PayoutWallet = {
  id: string;
  agent_id: string;
  wallet_address: string;
  status: WalletStatus;
  verification_method: string;
  verified_at: string | null;
};

export function isRewardMode(value: unknown): value is RewardMode {
  return typeof value === "string" && (REWARD_MODES as readonly string[]).includes(value);
}

/**
 * Reward mode of an agent. An explicit profile always wins. Without one, a
 * platform-operated demo agent is `karma_only` (never paid by default) and any
 * other agent is `public`, which still pays nothing until public payouts are
 * enabled by an administrator.
 */
export function resolveRewardMode(
  agent: Pick<AgentFacts, "is_demo">,
  profile: RewardProfile | null | undefined,
): RewardMode {
  if (profile && isRewardMode(profile.reward_mode)) return profile.reward_mode;
  return agent.is_demo ? "karma_only" : "public";
}

/** Banned and suspended agents, and agents whose rewards are disabled, earn nothing. */
export function canEarnKarma(agent: AgentFacts | undefined, mode: RewardMode): boolean {
  if (!agent) return false;
  if (agent.status === "banned" || agent.status === "suspended") return false;
  return mode !== "disabled";
}

export function isWalletPayable(
  wallet: PayoutWallet | null | undefined,
  mode: RewardMode,
): boolean {
  if (!wallet) return false;
  if (!PAYABLE_WALLET_STATUSES.includes(wallet.status)) return false;
  // The administrator pilot exception is valid only while the agent is a pilot agent.
  if (wallet.status === "admin_verified_pilot" && mode !== "pilot") return false;
  return true;
}

export type IneligibleReason =
  | "mode_disabled"
  | "mode_karma_only"
  | "pilot_payouts_disabled"
  | "public_payouts_disabled"
  | "agent_suspended"
  | "agent_banned"
  | "agent_missing"
  | "agent_too_new"
  | "below_min_daily_karma"
  | "excluded_by_admin";

export type RetainReason = "no_verified_wallet" | "monetary_disabled";

export type ParticipationDecision =
  | { participant: false; reason: IneligibleReason }
  | { participant: true; payable: true }
  | { participant: true; payable: false; retainReason: RetainReason };

/**
 * Decides whether an agent with Daily Karma takes part in an epoch's
 * distribution. A participant counts towards Total Eligible Daily Karma. A
 * participant without a verified wallet (or with monetary rewards disabled) is
 * NOT redistributed to others: its share is retained in the Reward Pool.
 */
export function decideParticipation(input: {
  agent: AgentFacts | undefined;
  mode: RewardMode;
  monetaryEnabled: boolean;
  wallet: PayoutWallet | null | undefined;
  dailyKarma: bigint;
  excluded: boolean;
  epochEndsAt: string;
  settings: Pick<
    EffectiveRewardSettings,
    "pilotPayoutsEnabled" | "publicPayoutsEnabled" | "minAgentAgeHours" | "minDailyKarma"
  >;
}): ParticipationDecision {
  const { agent, mode, settings } = input;
  if (!agent) return { participant: false, reason: "agent_missing" };
  if (agent.status === "banned") return { participant: false, reason: "agent_banned" };
  if (agent.status === "suspended") return { participant: false, reason: "agent_suspended" };
  if (mode === "disabled") return { participant: false, reason: "mode_disabled" };
  if (mode === "karma_only") return { participant: false, reason: "mode_karma_only" };
  if (mode === "pilot" && !settings.pilotPayoutsEnabled)
    return { participant: false, reason: "pilot_payouts_disabled" };
  if (mode === "public" && !settings.publicPayoutsEnabled)
    return { participant: false, reason: "public_payouts_disabled" };
  if (input.excluded) return { participant: false, reason: "excluded_by_admin" };
  const ageMs = Date.parse(input.epochEndsAt) - Date.parse(agent.created_at);
  if (!(ageMs >= settings.minAgentAgeHours * 3_600_000))
    return { participant: false, reason: "agent_too_new" };
  if (input.dailyKarma < BigInt(settings.minDailyKarma) || input.dailyKarma <= 0n)
    return { participant: false, reason: "below_min_daily_karma" };
  if (!input.monetaryEnabled)
    return { participant: true, payable: false, retainReason: "monetary_disabled" };
  if (!isWalletPayable(input.wallet, mode))
    return { participant: true, payable: false, retainReason: "no_verified_wallet" };
  return { participant: true, payable: true };
}
