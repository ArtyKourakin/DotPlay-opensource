// Reward-system environment. SERVER ONLY.
//
// None of these variables has a VITE_ prefix, so Vite never inlines them into
// the browser bundle. SOLANA_RPC_URL may contain a provider credential: it is
// read only here and in rpc.server.ts and is reported as Configured / Missing.

import type { RewardEnv, SolanaNetwork } from "./config";
import { SOLANA_NETWORKS } from "./config";

function readInt(name: string, min: number, max: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function readLamports(name: string): bigint | undefined {
  const raw = process.env[name]?.trim();
  return raw && /^\d{1,19}$/.test(raw) ? BigInt(raw) : undefined;
}

export function readRewardEnv(): RewardEnv {
  const network = (process.env["SOLANA_NETWORK"] ?? "mainnet-beta").trim() as SolanaNetwork;
  const wallet = (process.env["REWARD_POOL_WALLET_ADDRESS"] ?? "").trim();
  return {
    rewardsEnabled: process.env["REWARDS_ENABLED"] === "true",
    distributionEnabled: process.env["REWARD_DISTRIBUTION_ENABLED"] === "true",
    network: SOLANA_NETWORKS.includes(network) ? network : "mainnet-beta",
    rpcConfigured: Boolean(process.env["SOLANA_RPC_URL"]?.trim()),
    poolWalletAddress: wallet || null,
    maxDistributionBps: readInt("REWARD_DISTRIBUTION_BPS", 0, 10000),
    maxAgentShareBps: readInt("REWARD_MAX_AGENT_SHARE_BPS", 1, 10000),
    maxWalletShareBps: readInt("REWARD_MAX_WALLET_SHARE_BPS", 1, 10000),
    minDailyKarmaFloor: readInt("REWARD_MIN_DAILY_KARMA", 0, 1_000_000),
    minPayoutLamportsFloor: readLamports("REWARD_MIN_PAYOUT_LAMPORTS"),
    epochHourUtc: readInt("REWARD_EPOCH_HOUR_UTC", 0, 23),
  };
}

/** The RPC endpoint. Never returned from any function that reaches a client. */
export function readRpcUrl(): string | null {
  const url = process.env["SOLANA_RPC_URL"]?.trim();
  return url && /^https:\/\//.test(url) ? url : null;
}

/** Safe summary for the admin panel: presence and public values only. */
export function describeRewardEnv(env: RewardEnv) {
  return {
    rewards_enabled_env: env.rewardsEnabled,
    distribution_enabled_env: env.distributionEnabled,
    solana_network: env.network,
    solana_rpc_url: env.rpcConfigured ? ("Configured" as const) : ("Missing" as const),
    solana_rpc_https: readRpcUrl() ? true : env.rpcConfigured ? false : null,
    reward_pool_wallet_address: env.poolWalletAddress,
    env_max_distribution_bps: env.maxDistributionBps ?? null,
    env_max_agent_share_bps: env.maxAgentShareBps ?? null,
    env_max_wallet_share_bps: env.maxWalletShareBps ?? null,
    env_min_daily_karma: env.minDailyKarmaFloor ?? null,
    env_min_payout_lamports: env.minPayoutLamportsFloor?.toString() ?? null,
    env_epoch_hour_utc: env.epochHourUtc ?? null,
  };
}
