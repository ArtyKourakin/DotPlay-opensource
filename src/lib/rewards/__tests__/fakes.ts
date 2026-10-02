// In-memory doubles for the reward system. No database, no network, no money.
// The fake store enforces the same invariants the SQL migration enforces
// (unique idempotency keys, the epoch transition table, immutable finalized
// allocations, one live payout per allocation, one payout per on-chain
// transfer), so the service tests exercise those guarantees too.

import { DEFAULT_SETTINGS_ROW, type RewardEnv, type RewardSettingsRow } from "../config";
import type { AgentFacts } from "../eligibility";
import { canTransition, type EpochState } from "../epochs";
import type { ParsedTransaction, SignatureInfo, SolanaRpc } from "../fees";
import type {
  AuditEvent,
  BatchRow,
  EpochRow,
  NonceRow,
  PayoutRow,
  PoolStateRow,
  ProfileRow,
  RewardDeps,
  RewardStore,
  StoredAllocation,
  StoredFee,
  StoredKarmaEvent,
  WalletRow,
} from "../ports";
import type { SourceComment, SourcePost, SourceReaction } from "../karma";
import { contentFingerprint } from "../fingerprint";

let seq = 0;
export const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`;
};

export type FakeDb = {
  settings: RewardSettingsRow | null;
  pool: PoolStateRow;
  agents: AgentFacts[];
  profiles: ProfileRow[];
  epochs: EpochRow[];
  posts: SourcePost[];
  comments: SourceComment[];
  reactions: SourceReaction[];
  events: StoredKarmaEvent[];
  fees: StoredFee[];
  exclusions: { epoch_id: string; agent_id: string; reason: string; lifted: boolean }[];
  allocations: StoredAllocation[];
  batches: BatchRow[];
  payouts: PayoutRow[];
  wallets: WalletRow[];
  nonces: NonceRow[];
  audit: (AuditEvent & { id: string; created_at: string })[];
  now: Date;
};

export function makeDb(overrides: Partial<FakeDb> = {}): FakeDb {
  return {
    settings: { ...DEFAULT_SETTINGS_ROW, karma_enabled: true },
    pool: {
      wallet_address: null,
      pool_balance_lamports: null,
      balance_slot: null,
      balance_checked_at: null,
      rpc_last_ok_at: null,
      rpc_last_error: null,
      indexer_cursor_signature: null,
      indexer_synced_at: null,
      indexer_last_run_at: null,
      indexer_last_error: null,
      public_snapshot: null,
      public_snapshot_at: null,
    },
    agents: [],
    profiles: [],
    epochs: [],
    posts: [],
    comments: [],
    reactions: [],
    events: [],
    fees: [],
    exclusions: [],
    allocations: [],
    batches: [],
    payouts: [],
    wallets: [],
    nonces: [],
    audit: [],
    now: new Date("2026-10-01T12:00:00.000Z"),
    ...overrides,
  };
}

export class Refused extends Error {}

export function makeStore(db: FakeDb): RewardStore {
  const epochById = (id: string) => db.epochs.find((e) => e.id === id) ?? null;
  const finalizedEpoch = (id: string) =>
    ["approved", "paying", "paid", "cancelled"].includes(epochById(id)?.state ?? "");

  const store: RewardStore = {
    async getSettings() {
      return db.settings ? { ...db.settings } : null;
    },
    async updateSettings(patch) {
      if (!db.settings) throw new Refused("no settings");
      db.settings = { ...db.settings, ...patch };
    },
    async getPoolState() {
      return { ...db.pool };
    },
    async updatePoolState(patch) {
      db.pool = { ...db.pool, ...patch };
    },
    async listAgents() {
      return db.agents.map((a) => ({ ...a }));
    },
    async listProfiles() {
      return db.profiles.map((p) => ({ ...p }));
    },
    async upsertProfile(row) {
      const existing = db.profiles.find((p) => p.agent_id === row.agent_id);
      if (existing) Object.assign(existing, row, { updated_at: db.now.toISOString() });
      else db.profiles.push({ admin_notes: null, ...row, updated_at: db.now.toISOString() });
    },
    async getLatestEpoch() {
      return [...db.epochs].sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0] ?? null;
    },
    async getEpoch(id) {
      const e = epochById(id);
      return e ? { ...e } : null;
    },
    async listEpochs({ states, limit }) {
      return [...db.epochs]
        .filter((e) => !states || states.includes(e.state))
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },
    async insertEpoch(window) {
      const existing = db.epochs.find((e) => e.epoch_key === window.epoch_key);
      if (existing) return { ...existing };
      const row: EpochRow = {
        id: uuid(),
        ...window,
        state: "open",
        run_mode: "dry_run",
        fee_income_lamports: 0n,
        distribution_bps: null,
        reward_pool_lamports: 0n,
        payable_lamports: 0n,
        carried_forward_lamports: 0n,
        retained_lamports: 0n,
        total_daily_karma: 0n,
        eligible_daily_karma: 0n,
        eligible_agent_count: 0,
        calculation_version: 0,
        calculated_at: null,
        approved_at: null,
        paid_at: null,
        cancelled_at: null,
        cancel_reason: null,
        failure_code: null,
      };
      db.epochs.push(row);
      return { ...row };
    },
    async transitionEpoch(id, from, to, patch = {}) {
      const e = epochById(id);
      if (!e || e.state !== from) return false;
      if (!canTransition(from, to))
        throw new Refused(`invalid reward epoch transition: ${from} -> ${to}`);
      Object.assign(e, patch, { state: to });
      return true;
    },
    async updateEpoch(id, patch) {
      const e = epochById(id);
      if (e) Object.assign(e, patch);
    },
    async loadSources(startsAt, endsAt) {
      const inWindow = (t: string) => t >= startsAt && t < endsAt;
      return {
        posts: db.posts.filter((p) => inWindow(p.created_at)).map((p) => ({ ...p })),
        comments: db.comments
          .filter((c) => inWindow(c.created_at))
          .map((c) => ({
            ...c,
            post_hidden: db.posts.find((p) => p.id === c.post_id)?.hidden ?? c.post_hidden,
          })),
        reactions: db.reactions
          .filter((r) => inWindow(r.created_at))
          .map((r) => ({
            ...r,
            post_hidden: db.posts.find((p) => p.id === r.post_id)?.hidden ?? r.post_hidden,
          })),
      };
    },
    async loadPriorFingerprints(since, before) {
      return [
        ...new Set(
          db.events
            .filter(
              (e) => e.content_fingerprint && e.occurred_at >= since && e.occurred_at < before,
            )
            .map((e) => e.content_fingerprint!),
        ),
      ];
    },
    async listKarmaEvents(epochId) {
      return db.events.filter((e) => e.epoch_id === epochId).map((e) => ({ ...e }));
    },
    async insertKarmaEvents(epochId, drafts) {
      if (finalizedEpoch(epochId))
        throw new Refused("karma events of a finalized epoch are immutable");
      for (const d of drafts) {
        if (db.events.some((e) => e.idempotency_key === d.idempotency_key)) continue; // unique key
        db.events.push({
          ...d,
          id: uuid(),
          epoch_id: epochId,
          invalidation_reason: null,
          invalidated_at: null,
        });
      }
    },
    async updateKarmaEvent(id, patch) {
      const e = db.events.find((x) => x.id === id);
      if (!e) return;
      if (finalizedEpoch(e.epoch_id))
        throw new Refused("karma events of a finalized epoch are immutable");
      Object.assign(e, patch);
    },
    async getKarmaEvent(id) {
      const e = db.events.find((x) => x.id === id);
      return e ? { ...e } : null;
    },
    async lifetimeKarma(agentIds) {
      const out = new Map<string, bigint>();
      for (const e of db.events) {
        if (e.status !== "valid" || (agentIds && !agentIds.includes(e.agent_id))) continue;
        out.set(e.agent_id, (out.get(e.agent_id) ?? 0n) + BigInt(e.points));
      }
      return out;
    },
    async insertFeeTransfers(rows) {
      for (const r of rows) {
        if (
          db.fees.some((f) => f.signature === r.signature && f.transfer_index === r.transfer_index)
        )
          continue;
        db.fees.push({ ...r, id: uuid(), excluded_reason: null });
      }
    },
    async listFeeTransfers(startsAt, endsAt) {
      return db.fees
        .filter((f) => f.block_time >= startsAt && f.block_time < endsAt)
        .map((f) => ({ ...f }));
    },
    async getFee(id) {
      const f = db.fees.find((x) => x.id === id);
      return f ? { ...f } : null;
    },
    async updateFee(id, patch) {
      const f = db.fees.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    },
    async listExclusions(epochId) {
      return db.exclusions
        .filter((x) => x.epoch_id === epochId && !x.lifted)
        .map(({ agent_id, reason }) => ({ agent_id, reason }));
    },
    async addExclusion(epochId, agentId, reason) {
      if (db.exclusions.some((x) => x.epoch_id === epochId && x.agent_id === agentId && !x.lifted))
        return false;
      db.exclusions.push({ epoch_id: epochId, agent_id: agentId, reason, lifted: false });
      return true;
    },
    async liftExclusion(epochId, agentId) {
      const x = db.exclusions.find(
        (e) => e.epoch_id === epochId && e.agent_id === agentId && !e.lifted,
      );
      if (!x) return false;
      x.lifted = true;
      return true;
    },
    async listAllocations(epochId) {
      return db.allocations.filter((a) => a.epoch_id === epochId).map((a) => ({ ...a }));
    },
    async saveAllocations(epochId, rows, version) {
      for (const r of rows) {
        const existing = db.allocations.find(
          (a) => a.epoch_id === epochId && a.agent_id === r.agent_id,
        );
        if (existing?.finalized_at) throw new Refused("finalized reward allocation is immutable");
        if (existing) Object.assign(existing, r, { calculation_version: version });
        else
          db.allocations.push({
            ...r,
            id: uuid(),
            epoch_id: epochId,
            calculation_version: version,
            finalized_at: null,
            paid_at: null,
            carried_into_allocation_id: null,
          });
      }
      const keep = new Set(rows.map((r) => r.agent_id));
      for (const a of db.allocations.filter(
        (x) => x.epoch_id === epochId && !keep.has(x.agent_id) && !x.finalized_at,
      ))
        Object.assign(a, {
          status: "void",
          gross_lamports: 0n,
          payable_lamports: 0n,
          carried_forward_lamports: 0n,
          retained_lamports: 0n,
          carry_in_lamports: 0n,
          carry_source_allocation_id: null,
        });
    },
    async pendingCarry(agentIds, before) {
      const out = new Map<
        string,
        { allocation_id: string; agent_id: string; lamports: bigint; starts: string }
      >();
      for (const a of db.allocations) {
        if (
          a.status !== "carried_forward" ||
          a.carried_into_allocation_id ||
          !a.finalized_at ||
          !agentIds.includes(a.agent_id)
        )
          continue;
        const starts = epochById(a.epoch_id)!.starts_at;
        if (starts >= before) continue;
        const prev = out.get(a.agent_id);
        if (!prev || prev.starts < starts)
          out.set(a.agent_id, {
            allocation_id: a.id,
            agent_id: a.agent_id,
            lamports: a.carried_forward_lamports,
            starts,
          });
      }
      return [...out.values()].map(({ allocation_id, agent_id, lamports }) => ({
        allocation_id,
        agent_id,
        lamports,
      }));
    },
    async approveEpoch(epochId, adminId, version) {
      const e = epochById(epochId);
      if (!e) throw new Refused("epoch_not_found");
      if (e.state !== "review") throw new Refused("epoch_not_in_review");
      if (e.run_mode !== "live") throw new Refused("dry_run_epoch_cannot_be_approved");
      if (e.calculation_version !== version) throw new Refused("stale_calculation");
      for (const a of db.allocations.filter(
        (x) => x.epoch_id === epochId && x.carry_source_allocation_id && x.status !== "void",
      )) {
        const source = db.allocations.find((x) => x.id === a.carry_source_allocation_id);
        if (!source || source.status !== "carried_forward" || source.carried_into_allocation_id)
          throw new Refused("carry_forward_already_consumed");
        source.carried_into_allocation_id = a.id;
      }
      for (const a of db.allocations.filter(
        (x) => x.epoch_id === epochId && !x.finalized_at && x.status !== "void",
      ))
        a.finalized_at = db.now.toISOString();
      Object.assign(e, { state: "approved" as EpochState, approved_at: db.now.toISOString() });
      void adminId;
    },
    async listAgentAllocations(agentId, limit) {
      return db.allocations
        .filter((a) => a.agent_id === agentId)
        .slice(0, limit)
        .map((a) => ({ ...a, epoch_key: epochById(a.epoch_id)!.epoch_key }));
    },
    async createPayoutBatch(input) {
      const e = epochById(input.epochId);
      if (!e || !(e.state === "approved" || e.state === "failed") || !e.approved_at)
        throw new Refused("epoch_not_approved");
      if (db.batches.some((b) => b.epoch_id === input.epochId && b.status === "prepared"))
        throw new Refused("open batch exists");
      if (input.items.length === 0) throw new Refused("empty_plan");
      const batch: BatchRow = {
        id: uuid(),
        epoch_id: input.epochId,
        status: "prepared",
        source_wallet_address: input.sourceWallet,
        network: input.network,
        total_lamports: 0n,
        payout_count: 0,
        plan_checksum: input.checksum,
        created_at: db.now.toISOString(),
        confirmed_at: null,
      };
      const created: PayoutRow[] = [];
      for (const item of input.items) {
        const a = db.allocations.find((x) => x.id === item.allocation_id);
        if (
          !a ||
          a.epoch_id !== input.epochId ||
          !a.finalized_at ||
          a.status !== "payable" ||
          a.wallet_address !== item.recipient_address ||
          a.payable_lamports !== item.lamports
        )
          throw new Refused("plan_item_mismatch");
        if (
          [...db.payouts, ...created].some(
            (p) =>
              p.allocation_id === a.id && ["pending", "submitted", "confirmed"].includes(p.status),
          )
        )
          throw new Refused(
            "duplicate key value violates unique constraint reward_payouts_allocation_live_idx",
          );
        created.push({
          id: uuid(),
          batch_id: batch.id,
          allocation_id: a.id,
          agent_id: a.agent_id,
          recipient_address: a.wallet_address!,
          lamports: a.payable_lamports,
          status: "pending",
          tx_signature: null,
          transfer_index: null,
          submitted_at: null,
          confirmed_at: null,
          last_failure_code: null,
          created_at: db.now.toISOString(),
        });
      }
      batch.total_lamports = created.reduce((s, p) => s + p.lamports, 0n);
      batch.payout_count = created.length;
      db.batches.push(batch);
      db.payouts.push(...created);
      e.state = "paying";
      return batch.id;
    },
    async getBatch(id) {
      const b = db.batches.find((x) => x.id === id);
      return b ? { ...b } : null;
    },
    async listBatches(epochId) {
      return db.batches.filter((b) => b.epoch_id === epochId).map((b) => ({ ...b }));
    },
    async updateBatch(id, patch) {
      const b = db.batches.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
    },
    async listPayouts(filter) {
      return db.payouts
        .filter((p) => !filter.batchId || p.batch_id === filter.batchId)
        .filter(
          (p) =>
            !filter.epochId ||
            db.batches.find((b) => b.id === p.batch_id)?.epoch_id === filter.epochId,
        )
        .filter((p) => !filter.status || filter.status.includes(p.status))
        .map((p) => ({ ...p }));
    },
    async getPayout(id) {
      const p = db.payouts.find((x) => x.id === id);
      return p ? { ...p } : null;
    },
    async updatePayout(id, fromStatuses, patch) {
      const p = db.payouts.find((x) => x.id === id);
      if (!p || !fromStatuses.includes(p.status)) return false;
      if (p.status === "confirmed") throw new Refused("confirmed reward payout is immutable");
      const next = { ...p, ...patch };
      if (
        next.tx_signature &&
        db.payouts.some(
          (o) =>
            o.id !== id &&
            o.tx_signature === next.tx_signature &&
            o.transfer_index === next.transfer_index,
        )
      )
        throw new Refused(
          "duplicate key value violates unique constraint reward_payouts_transfer_idx",
        );
      Object.assign(p, patch);
      return true;
    },
    async confirmPayout(id, signature, transferIndex) {
      const p = db.payouts.find((x) => x.id === id);
      if (!p) throw new Refused("payout_not_found");
      if (p.status === "confirmed") return;
      if (!["pending", "submitted"].includes(p.status)) throw new Refused("payout_not_open");
      Object.assign(p, {
        status: "confirmed",
        tx_signature: signature,
        transfer_index: transferIndex,
        confirmed_at: db.now.toISOString(),
      });
      const a = db.allocations.find((x) => x.id === p.allocation_id)!;
      if (a.status === "payable")
        Object.assign(a, { status: "paid", paid_at: db.now.toISOString() });
      const batch = db.batches.find((b) => b.id === p.batch_id)!;
      if (
        !db.payouts.some(
          (x) => x.batch_id === batch.id && ["pending", "submitted"].includes(x.status),
        )
      ) {
        batch.status = "confirmed";
        const e = epochById(batch.epoch_id)!;
        if (
          !db.allocations.some((x) => x.epoch_id === e.id && x.status === "payable") &&
          e.state === "paying"
        )
          e.state = "paid";
      }
    },
    async usedTransferIndexes(signature, except) {
      return new Set(
        db.payouts
          .filter((p) => p.id !== except && p.tx_signature === signature && p.transfer_index)
          .map((p) => p.transfer_index!),
      );
    },
    async listAgentPayouts(agentId, limit) {
      return db.payouts
        .filter((p) => p.agent_id === agentId)
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
    async listCurrentWallets() {
      return db.wallets.filter((w) => w.is_current).map((w) => ({ ...w }));
    },
    async getCurrentWallet(agentId) {
      const w = db.wallets.find((x) => x.agent_id === agentId && x.is_current);
      return w ? { ...w } : null;
    },
    async listWalletHistory(agentId) {
      return db.wallets.filter((w) => w.agent_id === agentId).map((w) => ({ ...w }));
    },
    async replaceWallet(input) {
      if (!db.agents.some((a) => a.id === input.agentId)) throw new Refused("agent_not_found");
      for (const w of db.wallets.filter((x) => x.agent_id === input.agentId && x.is_current)) {
        Object.assign(w, {
          is_current: false,
          status: "revoked",
          revoked_at: db.now.toISOString(),
          last_action_reason: input.reason ?? "replaced",
        });
        db.audit.push({
          id: uuid(),
          created_at: db.now.toISOString(),
          actor_type: input.actorType,
          actor_id: input.actorId,
          agent_id: input.agentId,
          action: "wallet.status_changed",
          reason: input.reason,
          previous_values: { wallet_address: w.wallet_address },
          new_values: { status: "revoked" },
        });
      }
      const row: WalletRow = {
        id: uuid(),
        agent_id: input.agentId,
        wallet_address: input.address,
        status: input.status,
        verification_method: input.method,
        verified_at: input.status === "submitted" ? null : db.now.toISOString(),
        is_current: true,
        revoked_at: null,
        created_at: db.now.toISOString(),
        created_by_type: input.actorType,
        last_action_reason: input.reason,
      };
      db.wallets.push(row);
      // Mirrors the agent_payout_wallets_audit trigger.
      db.audit.push({
        id: uuid(),
        created_at: db.now.toISOString(),
        actor_type: input.actorType,
        actor_id: input.actorId,
        agent_id: input.agentId,
        action: "wallet.connected",
        reason: input.reason,
        new_values: { wallet_address: input.address, status: input.status },
      });
      return row.id;
    },
    async revokeCurrentWallet(agentId, actorType, actorId, reason) {
      const w = db.wallets.find((x) => x.agent_id === agentId && x.is_current);
      if (!w) return false;
      Object.assign(w, {
        is_current: false,
        status: "revoked",
        revoked_at: db.now.toISOString(),
        last_action_reason: reason,
      });
      db.audit.push({
        id: uuid(),
        created_at: db.now.toISOString(),
        actor_type: actorType,
        actor_id: actorId,
        agent_id: agentId,
        action: "wallet.status_changed",
        reason,
        new_values: { status: "revoked" },
      });
      return true;
    },
    async createNonce(row) {
      const id = uuid();
      db.nonces.push({ ...row, id, consumed_at: null });
      return id;
    },
    async consumeNonce(id, agentId, nowIso) {
      const n = db.nonces.find(
        (x) => x.id === id && x.agent_id === agentId && !x.consumed_at && x.expires_at > nowIso,
      );
      if (!n) return null;
      n.consumed_at = nowIso;
      return { ...n };
    },
    async countRecentNonces(agentId, since) {
      return db.nonces.filter(
        (n) =>
          n.agent_id === agentId && (n as NonceRow & { created_at?: string }).expires_at > since,
      ).length;
    },
    async audit(event) {
      db.audit.push({ ...event, id: uuid(), created_at: db.now.toISOString() });
    },
    async listAudit({ agentId, limit }) {
      return db.audit
        .filter((e) => !agentId || e.agent_id === agentId)
        .slice(-limit)
        .reverse();
    },
  };
  return store;
}

export const ENABLED_ENV: RewardEnv = {
  rewardsEnabled: true,
  distributionEnabled: true,
  network: "mainnet-beta",
  rpcConfigured: true,
  poolWalletAddress: "PooL1111111111111111111111111111111111111111",
  maxDistributionBps: undefined,
  maxAgentShareBps: undefined,
  maxWalletShareBps: undefined,
  minDailyKarmaFloor: undefined,
  minPayoutLamportsFloor: undefined,
  epochHourUtc: undefined,
};

export type FakeChain = {
  signatures: SignatureInfo[]; // newest first
  transactions: Map<string, ParsedTransaction>;
  finalized: Set<string>;
  balance: bigint;
  fail: string | null;
  calls: string[];
};

export function makeChain(): FakeChain {
  return {
    signatures: [],
    transactions: new Map(),
    finalized: new Set(),
    balance: 0n,
    fail: null,
    calls: [],
  };
}

export function makeRpc(chain: FakeChain): SolanaRpc {
  const guard = (method: string) => {
    chain.calls.push(method);
    if (chain.fail) throw Object.assign(new Error(chain.fail), { code: chain.fail });
  };
  return {
    async getHealth() {
      guard("getHealth");
      return "ok";
    },
    async getBalance() {
      guard("getBalance");
      return { lamports: chain.balance, slot: 100 };
    },
    async getSignaturesForAddress(_address, { before, until, limit }) {
      guard("getSignaturesForAddress");
      let list = chain.signatures.filter((s) => chain.finalized.has(s.signature));
      if (until) {
        const i = list.findIndex((s) => s.signature === until);
        if (i >= 0) list = list.slice(0, i);
      }
      if (before) {
        const i = list.findIndex((s) => s.signature === before);
        list = i >= 0 ? list.slice(i + 1) : [];
      }
      return list.slice(0, limit).map((s) => ({ ...s, confirmationStatus: "finalized" }));
    },
    async getTransaction(signature, commitment) {
      guard("getTransaction");
      const tx = chain.transactions.get(signature) ?? null;
      if (!tx) return null;
      if (commitment === "finalized" && !chain.finalized.has(signature)) return null;
      return tx;
    },
  };
}

export const POOL = ENABLED_ENV.poolWalletAddress!;

/** A parsed transaction with native transfers, in the jsonParsed shape. */
export function transferTx(
  transfers: { source: string; destination: string; lamports: number }[],
  opts: {
    blockTime?: number | null;
    err?: unknown;
    slot?: number;
    inner?: {
      index: number;
      transfers: { source: string; destination: string; lamports: number }[];
    }[];
  } = {},
): ParsedTransaction {
  const ix = (t: { source: string; destination: string; lamports: number }) => ({
    program: "system",
    programId: "11111111111111111111111111111111",
    parsed: {
      type: "transfer",
      info: { source: t.source, destination: t.destination, lamports: t.lamports },
    },
  });
  return {
    slot: opts.slot ?? 1000,
    blockTime:
      opts.blockTime === undefined ? Date.parse("2026-10-01T10:00:00Z") / 1000 : opts.blockTime,
    meta: {
      err: opts.err ?? null,
      innerInstructions: (opts.inner ?? []).map((g) => ({
        index: g.index,
        instructions: g.transfers.map(ix),
      })),
    },
    transaction: { message: { instructions: transfers.map(ix) } },
  };
}

export function makeDeps(
  db: FakeDb,
  options: { env?: Partial<RewardEnv>; chain?: FakeChain | null } = {},
): RewardDeps {
  const chain = options.chain === undefined ? makeChain() : options.chain;
  return {
    store: makeStore(db),
    rpc: chain ? makeRpc(chain) : null,
    env: { ...ENABLED_ENV, ...options.env },
    now: () => db.now,
    isValidPoolAddress: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
    fingerprint: contentFingerprint,
  };
}

export function agent(id: string, overrides: Partial<AgentFacts> = {}): AgentFacts {
  return {
    id,
    username: id,
    name: id,
    status: "active",
    created_at: "2026-09-01T00:00:00.000Z",
    is_demo: false,
    demo_persona_key: null,
    ...overrides,
  };
}

export const LONG_POST =
  "This week I mapped the retry behaviour of forty agent frameworks and found three recurring failure patterns worth sharing with everyone.";
export const LONG_COMMENT =
  "Thanks, the second failure pattern matches what I measured in my own queue workers last week.";
