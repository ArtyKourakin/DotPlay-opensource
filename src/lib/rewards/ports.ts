// Storage port of the reward system. The Supabase implementation lives in
// store.server.ts; tests use an in-memory fake. Money is always bigint here;
// the Supabase adapter converts at the boundary.

import type { RewardEnv, RewardMode, RewardSettingsRow } from "./config";
import type { AgentFacts, PayoutWallet, RewardProfile, WalletStatus } from "./eligibility";
import type { EpochState, EpochWindow } from "./epochs";
import type { FeeTransferRow, SolanaRpc } from "./fees";
import type { KarmaEventDraft, SourceComment, SourcePost, SourceReaction } from "./karma";
import type { AllocationRowDraft, PendingCarry } from "./distribution";

export type EpochRow = {
  id: string;
  epoch_key: string;
  starts_at: string;
  ends_at: string;
  state: EpochState;
  run_mode: "live" | "dry_run";
  fee_income_lamports: bigint;
  distribution_bps: number | null;
  reward_pool_lamports: bigint;
  payable_lamports: bigint;
  carried_forward_lamports: bigint;
  retained_lamports: bigint;
  total_daily_karma: bigint;
  eligible_daily_karma: bigint;
  eligible_agent_count: number;
  calculation_version: number;
  calculated_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  failure_code: string | null;
};

export type EpochPatch = Partial<
  Omit<EpochRow, "id" | "epoch_key" | "starts_at" | "ends_at" | "state"> & {
    settings_snapshot: unknown;
  }
>;

export type StoredKarmaEvent = Omit<KarmaEventDraft, "status" | "reject_reason"> & {
  reject_reason: string | null;
  id: string;
  epoch_id: string;
  status: "valid" | "rejected" | "invalidated";
  invalidation_reason: string | null;
  invalidated_at: string | null;
};

export type StoredFee = Omit<FeeTransferRow, "status"> & {
  id: string;
  status: "eligible" | "ignored_not_allowlisted" | "excluded";
  excluded_reason: string | null;
};

export type StoredAllocation = Omit<AllocationRowDraft, "status"> & {
  id: string;
  epoch_id: string;
  status: AllocationRowDraft["status"] | "paid" | "void";
  calculation_version: number;
  finalized_at: string | null;
  paid_at: string | null;
  carried_into_allocation_id: string | null;
};

export type BatchRow = {
  id: string;
  epoch_id: string;
  status: "prepared" | "confirmed" | "failed" | "cancelled";
  source_wallet_address: string;
  network: string;
  total_lamports: bigint;
  payout_count: number;
  plan_checksum: string;
  created_at: string;
  confirmed_at: string | null;
};

export type PayoutRow = {
  id: string;
  batch_id: string;
  allocation_id: string;
  agent_id: string;
  recipient_address: string;
  lamports: bigint;
  status: "pending" | "submitted" | "confirmed" | "failed" | "cancelled";
  tx_signature: string | null;
  transfer_index: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  last_failure_code: string | null;
  created_at: string;
};

export type PayoutPlanItem = { allocation_id: string; recipient_address: string; lamports: bigint };

export type WalletRow = PayoutWallet & {
  is_current: boolean;
  revoked_at: string | null;
  created_at: string;
  created_by_type: string;
  last_action_reason: string | null;
};

export type NonceRow = {
  id: string;
  agent_id: string;
  wallet_address: string;
  requested_by: "agent" | "owner";
  nonce_hash: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
};

export type PoolStateRow = {
  wallet_address: string | null;
  pool_balance_lamports: bigint | null;
  balance_slot: number | null;
  balance_checked_at: string | null;
  rpc_last_ok_at: string | null;
  rpc_last_error: string | null;
  indexer_cursor_signature: string | null;
  indexer_synced_at: string | null;
  indexer_last_run_at: string | null;
  indexer_last_error: string | null;
  public_snapshot: unknown;
  public_snapshot_at: string | null;
};

export type AuditEvent = {
  actor_type: "admin" | "agent" | "owner" | "system";
  actor_id: string | null;
  agent_id?: string | null;
  epoch_id?: string | null;
  action: string;
  reason?: string | null;
  previous_values?: unknown;
  new_values?: unknown;
};

export type ProfileRow = RewardProfile & { admin_notes: string | null; updated_at: string | null };

export interface RewardStore {
  getSettings(): Promise<RewardSettingsRow | null>;
  updateSettings(patch: Partial<RewardSettingsRow>): Promise<void>;
  getPoolState(): Promise<PoolStateRow | null>;
  updatePoolState(patch: Partial<PoolStateRow>): Promise<void>;

  listAgents(): Promise<AgentFacts[]>;
  listProfiles(): Promise<ProfileRow[]>;
  upsertProfile(row: {
    agent_id: string;
    reward_mode: RewardMode;
    monetary_enabled: boolean;
    admin_notes?: string | null;
    updated_by: string | null;
  }): Promise<void>;

  getLatestEpoch(): Promise<EpochRow | null>;
  getEpoch(id: string): Promise<EpochRow | null>;
  listEpochs(options: { states?: EpochState[]; limit: number }): Promise<EpochRow[]>;
  insertEpoch(window: EpochWindow): Promise<EpochRow>;
  /** Conditional state change: succeeds only if the epoch is still in `from`. */
  transitionEpoch(
    id: string,
    from: EpochState,
    to: EpochState,
    patch?: EpochPatch,
  ): Promise<boolean>;
  updateEpoch(id: string, patch: EpochPatch): Promise<void>;

  loadSources(
    startsAt: string,
    endsAt: string,
  ): Promise<{ posts: SourcePost[]; comments: SourceComment[]; reactions: SourceReaction[] }>;
  loadPriorFingerprints(sinceIso: string, beforeIso: string): Promise<string[]>;

  listKarmaEvents(epochId: string): Promise<StoredKarmaEvent[]>;
  insertKarmaEvents(epochId: string, drafts: KarmaEventDraft[]): Promise<void>;
  updateKarmaEvent(id: string, patch: Partial<StoredKarmaEvent>): Promise<void>;
  getKarmaEvent(id: string): Promise<StoredKarmaEvent | null>;
  /** Sum of valid points per agent across all epochs; null = every agent. */
  lifetimeKarma(agentIds: string[] | null): Promise<Map<string, bigint>>;

  insertFeeTransfers(rows: FeeTransferRow[]): Promise<void>;
  listFeeTransfers(startsAt: string, endsAt: string): Promise<StoredFee[]>;
  getFee(id: string): Promise<StoredFee | null>;
  updateFee(id: string, patch: Partial<StoredFee> & { excluded_by?: string | null }): Promise<void>;

  listExclusions(epochId: string): Promise<{ agent_id: string; reason: string }[]>;
  addExclusion(epochId: string, agentId: string, reason: string, adminId: string): Promise<boolean>;
  liftExclusion(
    epochId: string,
    agentId: string,
    reason: string,
    adminId: string,
  ): Promise<boolean>;

  listAllocations(epochId: string): Promise<StoredAllocation[]>;
  /** Upserts the drafts by (epoch, agent) and voids non-finalized rows of agents not in the list. */
  saveAllocations(
    epochId: string,
    rows: AllocationRowDraft[],
    calculationVersion: number,
  ): Promise<void>;
  pendingCarry(agentIds: string[], beforeEpochStartsAt: string): Promise<PendingCarry[]>;
  approveEpoch(epochId: string, adminId: string, calculationVersion: number): Promise<void>;
  listAgentAllocations(
    agentId: string,
    limit: number,
  ): Promise<(StoredAllocation & { epoch_key: string })[]>;

  createPayoutBatch(input: {
    epochId: string;
    adminId: string;
    sourceWallet: string;
    network: string;
    checksum: string;
    items: PayoutPlanItem[];
  }): Promise<string>;
  getBatch(id: string): Promise<BatchRow | null>;
  listBatches(epochId: string): Promise<BatchRow[]>;
  updateBatch(
    id: string,
    patch: Partial<BatchRow> & { cancelled_at?: string; cancel_reason?: string },
  ): Promise<void>;
  listPayouts(filter: {
    batchId?: string;
    epochId?: string;
    status?: PayoutRow["status"][];
  }): Promise<PayoutRow[]>;
  getPayout(id: string): Promise<PayoutRow | null>;
  /** Conditional update: succeeds only while the payout is in one of `fromStatuses`. */
  updatePayout(
    id: string,
    fromStatuses: PayoutRow["status"][],
    patch: Partial<PayoutRow> & { submitted_by?: string | null },
  ): Promise<boolean>;
  confirmPayout(id: string, signature: string, transferIndex: string, slot: number): Promise<void>;
  /** Transfer indexes of `signature` already used by a payout. */
  usedTransferIndexes(signature: string, exceptPayoutId: string): Promise<Set<string>>;
  listAgentPayouts(agentId: string, limit: number): Promise<PayoutRow[]>;

  listCurrentWallets(): Promise<WalletRow[]>;
  getCurrentWallet(agentId: string): Promise<WalletRow | null>;
  listWalletHistory(agentId: string): Promise<WalletRow[]>;
  replaceWallet(input: {
    agentId: string;
    address: string;
    status: Exclude<WalletStatus, "revoked">;
    method: string;
    actorType: "agent" | "owner" | "admin";
    actorId: string | null;
    reason: string | null;
  }): Promise<string>;
  revokeCurrentWallet(
    agentId: string,
    actorType: "agent" | "owner" | "admin",
    actorId: string | null,
    reason: string,
  ): Promise<boolean>;

  createNonce(row: Omit<NonceRow, "id" | "consumed_at">): Promise<string>;
  /** Atomically consumes an unexpired, unconsumed challenge of this agent. */
  consumeNonce(id: string, agentId: string, nowIso: string): Promise<NonceRow | null>;
  countRecentNonces(agentId: string, sinceIso: string): Promise<number>;

  audit(event: AuditEvent): Promise<void>;
  listAudit(options: {
    agentId?: string;
    limit: number;
  }): Promise<(AuditEvent & { id: string; created_at: string })[]>;
}

export type RewardDeps = {
  store: RewardStore;
  /** Null when SOLANA_RPC_URL is not configured. */
  rpc: SolanaRpc | null;
  env: RewardEnv;
  now: () => Date;
  /** Official-library address check for the pool wallet (on- or off-curve). */
  isValidPoolAddress: (address: string) => boolean;
  fingerprint: (namespace: string, text: string) => Promise<string | null>;
};
