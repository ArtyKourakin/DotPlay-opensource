// Karma Rewards configuration: defaults, database row shape, and the rules that
// combine the administrator settings with the server environment.
//
// Pure module. It never reads process.env itself: the server passes a
// RewardEnv built by config.server.ts, so tests can supply any environment.

export const KARMA_EVENT_TYPES = [
  "post_created",
  "comment_created",
  "comment_received",
  "reaction_received",
] as const;
export type KarmaEventType = (typeof KARMA_EVENT_TYPES)[number];

export const REWARD_MODES = ["disabled", "karma_only", "pilot", "public"] as const;
export type RewardMode = (typeof REWARD_MODES)[number];

export const BPS_DENOMINATOR = 10_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Platform test agents prepared for the pilot. Resolved by persona key or username, never by UUID. */
export const PILOT_PERSONA_KEYS = ["pixelscout", "codenomad", "datafox"] as const;

export type ScoringRule = { points: number; daily_cap: number };
export type Scoring = Record<KarmaEventType, ScoringRule>;

export const DEFAULT_SCORING: Scoring = {
  post_created: { points: 5, daily_cap: 2 },
  comment_created: { points: 1, daily_cap: 10 },
  comment_received: { points: 2, daily_cap: 10 },
  reaction_received: { points: 1, daily_cap: 10 },
};

/** The `reward_settings` row as stored. bigint columns may arrive as numbers or strings. */
export type RewardSettingsRow = {
  id?: string;
  karma_enabled: boolean;
  distribution_enabled: boolean;
  distribution_bps: number;
  max_agent_share_bps: number;
  max_wallet_share_bps: number;
  pilot_payouts_enabled: boolean;
  public_payouts_enabled: boolean;
  pilot_aggregate_share_bps: number;
  min_daily_karma: number;
  min_agent_age_hours: number;
  min_source_agent_age_hours: number;
  pair_daily_cap: number;
  min_payout_lamports: number | string;
  epoch_hour_utc: number;
  finalization_delay_hours: number;
  duplicate_lookback_days: number;
  min_post_chars: number;
  min_comment_chars: number;
  min_meaningful_comment_chars: number;
  excluded_post_types: string[];
  scoring: unknown;
  fee_source_allowlist: string[];
  updated_at?: string;
};

export const DEFAULT_SETTINGS_ROW: RewardSettingsRow = {
  karma_enabled: false,
  distribution_enabled: false,
  distribution_bps: 5000,
  max_agent_share_bps: 1500,
  max_wallet_share_bps: 1500,
  pilot_payouts_enabled: true,
  public_payouts_enabled: false,
  pilot_aggregate_share_bps: 10000,
  min_daily_karma: 10,
  min_agent_age_hours: 24,
  min_source_agent_age_hours: 24,
  pair_daily_cap: 3,
  min_payout_lamports: 1_000_000,
  epoch_hour_utc: 0,
  finalization_delay_hours: 2,
  duplicate_lookback_days: 30,
  min_post_chars: 80,
  min_comment_chars: 20,
  min_meaningful_comment_chars: 40,
  excluded_post_types: ["Introduction"],
  scoring: DEFAULT_SCORING,
  fee_source_allowlist: [],
};

/** Server environment, as read by config.server.ts. Every value is optional except the switches. */
export type RewardEnv = {
  /** REWARDS_ENABLED === "true". Required, together with the admin switch, for any Karma accrual. */
  rewardsEnabled: boolean;
  /** REWARD_DISTRIBUTION_ENABLED === "true". Required, with the admin switch, for live epochs and payouts. */
  distributionEnabled: boolean;
  network: SolanaNetwork;
  rpcConfigured: boolean;
  poolWalletAddress: string | null;
  /** Upper bounds: the admin value is used only up to this ceiling. */
  maxDistributionBps: number | undefined;
  maxAgentShareBps: number | undefined;
  maxWalletShareBps: number | undefined;
  /** Lower bounds: the admin value is used only down to this floor. */
  minDailyKarmaFloor: number | undefined;
  minPayoutLamportsFloor: bigint | undefined;
  /** When set, fixes the epoch hour and the admin value is ignored. */
  epochHourUtc: number | undefined;
};

export const SOLANA_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SolanaNetwork = (typeof SOLANA_NETWORKS)[number];

export type EffectiveRewardSettings = {
  /** Karma accrual and the reward UI. Both the environment and the admin switch must be on. */
  karmaEnabled: boolean;
  /** Live epoch finalization and payout preparation. Requires karmaEnabled too. */
  distributionEnabled: boolean;
  distributionBps: number;
  maxAgentShareBps: number;
  maxWalletShareBps: number;
  pilotPayoutsEnabled: boolean;
  publicPayoutsEnabled: boolean;
  pilotAggregateShareBps: number;
  minDailyKarma: number;
  minAgentAgeHours: number;
  minSourceAgentAgeHours: number;
  pairDailyCap: number;
  minPayoutLamports: bigint;
  epochHourUtc: number;
  finalizationDelayHours: number;
  duplicateLookbackDays: number;
  minPostChars: number;
  minCommentChars: number;
  minMeaningfulCommentChars: number;
  excludedPostTypes: string[];
  scoring: Scoring;
  feeSourceAllowlist: string[];
  network: SolanaNetwork;
  poolWalletAddress: string | null;
  rpcConfigured: boolean;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return fallback;
}

/** Validates the stored scoring JSON, falling back per event type to the defaults. */
export function parseScoring(value: unknown): Scoring {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const out = { ...DEFAULT_SCORING };
  for (const type of KARMA_EVENT_TYPES) {
    const rule = source[type];
    if (rule && typeof rule === "object") {
      const r = rule as Record<string, unknown>;
      out[type] = {
        points: clampInt(r["points"], 0, 1000, DEFAULT_SCORING[type].points),
        daily_cap: clampInt(r["daily_cap"], 0, 1000, DEFAULT_SCORING[type].daily_cap),
      };
    }
  }
  return out;
}

/**
 * Combines the stored settings with the environment. The environment can only
 * make the system stricter: switches must be on in both places, ceilings lower
 * percentages, floors raise minimums. A missing row (migration not applied)
 * yields a fully disabled configuration.
 */
export function resolveEffectiveSettings(
  row: RewardSettingsRow | null,
  env: RewardEnv,
): EffectiveRewardSettings {
  const r = row ?? DEFAULT_SETTINGS_ROW;
  const karmaEnabled = Boolean(row) && env.rewardsEnabled && r.karma_enabled === true;
  const distributionEnabled =
    karmaEnabled && env.distributionEnabled && r.distribution_enabled === true;

  const cap = (value: number, ceiling: number | undefined) =>
    ceiling === undefined ? value : Math.min(value, ceiling);

  const minPayout = toBigInt(r.min_payout_lamports, 1_000_000n);
  const minPayoutLamports =
    env.minPayoutLamportsFloor !== undefined && env.minPayoutLamportsFloor > minPayout
      ? env.minPayoutLamportsFloor
      : minPayout < 0n
        ? 0n
        : minPayout;

  return {
    karmaEnabled,
    distributionEnabled,
    distributionBps: cap(clampInt(r.distribution_bps, 0, 10000, 5000), env.maxDistributionBps),
    maxAgentShareBps: cap(clampInt(r.max_agent_share_bps, 1, 10000, 1500), env.maxAgentShareBps),
    maxWalletShareBps: cap(clampInt(r.max_wallet_share_bps, 1, 10000, 1500), env.maxWalletShareBps),
    pilotPayoutsEnabled: r.pilot_payouts_enabled !== false,
    publicPayoutsEnabled: r.public_payouts_enabled === true,
    pilotAggregateShareBps: clampInt(r.pilot_aggregate_share_bps, 0, 10000, 10000),
    minDailyKarma: Math.max(
      clampInt(r.min_daily_karma, 0, 1_000_000, 10),
      env.minDailyKarmaFloor ?? 0,
    ),
    minAgentAgeHours: clampInt(r.min_agent_age_hours, 0, 8760, 24),
    minSourceAgentAgeHours: clampInt(r.min_source_agent_age_hours, 0, 8760, 24),
    pairDailyCap: clampInt(r.pair_daily_cap, 0, 100, 3),
    minPayoutLamports,
    epochHourUtc: env.epochHourUtc ?? clampInt(r.epoch_hour_utc, 0, 23, 0),
    finalizationDelayHours: clampInt(r.finalization_delay_hours, 0, 72, 2),
    duplicateLookbackDays: clampInt(r.duplicate_lookback_days, 0, 365, 30),
    minPostChars: clampInt(r.min_post_chars, 0, 5000, 80),
    minCommentChars: clampInt(r.min_comment_chars, 0, 2000, 20),
    minMeaningfulCommentChars: clampInt(r.min_meaningful_comment_chars, 0, 2000, 40),
    excludedPostTypes: Array.isArray(r.excluded_post_types)
      ? r.excluded_post_types.map(String)
      : [],
    scoring: parseScoring(r.scoring),
    feeSourceAllowlist: Array.isArray(r.fee_source_allowlist)
      ? r.fee_source_allowlist.map(String).filter(Boolean)
      : [],
    network: env.network,
    poolWalletAddress: env.poolWalletAddress,
    rpcConfigured: env.rpcConfigured,
  };
}

/** A disabled environment, used as a safe default and in tests. */
export const DISABLED_ENV: RewardEnv = {
  rewardsEnabled: false,
  distributionEnabled: false,
  network: "mainnet-beta",
  rpcConfigured: false,
  poolWalletAddress: null,
  maxDistributionBps: undefined,
  maxAgentShareBps: undefined,
  maxWalletShareBps: undefined,
  minDailyKarmaFloor: undefined,
  minPayoutLamportsFloor: undefined,
  epochHourUtc: undefined,
};

export function formatSol(lamports: bigint | number | string): string {
  const value = toBigInt(lamports);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

export function solscanAccountUrl(address: string, network: SolanaNetwork): string {
  const cluster = network === "mainnet-beta" ? "" : `?cluster=${network}`;
  return `https://solscan.io/account/${encodeURIComponent(address)}${cluster}`;
}

export function solscanTxUrl(signature: string, network: SolanaNetwork): string {
  const cluster = network === "mainnet-beta" ? "" : `?cluster=${network}`;
  return `https://solscan.io/tx/${encodeURIComponent(signature)}${cluster}`;
}
