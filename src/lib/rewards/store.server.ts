/* eslint-disable @typescript-eslint/no-explicit-any */
// Supabase implementation of the reward store. SERVER ONLY: it uses the
// service-role client, which bypasses RLS. Every reward table is private (RLS
// on, no policies), so this module is the only way in.
//
// Money crosses the boundary as strings (PostgREST accepts them for bigint)
// and comes back through toBigInt(), so no lamport value is ever a float.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { toBigInt, type RewardSettingsRow } from "./config";
import type { AgentFacts } from "./eligibility";
import type { EpochWindow } from "./epochs";
import type { FeeTransferRow } from "./fees";
import type { KarmaEventDraft } from "./karma";
import type { AllocationRowDraft, PendingCarry } from "./distribution";
import type {
  BatchRow,
  EpochRow,
  NonceRow,
  PayoutRow,
  PoolStateRow,
  ProfileRow,
  RewardStore,
  StoredAllocation,
  StoredFee,
  StoredKarmaEvent,
  WalletRow,
} from "./ports";

const db = supabaseAdmin as any;
const PAGE = 1000;

class StoreError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function check<T>(result: { data: T; error: unknown }, code = "store_failed"): T {
  if (result.error) throw new StoreError(code);
  return result.data;
}

/** Reads every row of a query in pages (PostgREST caps a response). */
async function all<T>(build: (from: number, to: number) => any, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const rows = check<T[]>(await build(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const big = (v: unknown) => toBigInt(v);

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
const str = (v: bigint) => v.toString();

function toEpoch(r: any): EpochRow {
  return {
    ...r,
    fee_income_lamports: big(r.fee_income_lamports),
    reward_pool_lamports: big(r.reward_pool_lamports),
    payable_lamports: big(r.payable_lamports),
    carried_forward_lamports: big(r.carried_forward_lamports),
    retained_lamports: big(r.retained_lamports),
    total_daily_karma: big(r.total_daily_karma),
    eligible_daily_karma: big(r.eligible_daily_karma),
  };
}

function epochPatchToDb(patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = typeof v === "bigint" ? str(v) : v;
  return out;
}

function toAllocation(r: any): StoredAllocation {
  return {
    ...r,
    daily_karma: big(r.daily_karma),
    gross_lamports: big(r.gross_lamports),
    carry_in_lamports: big(r.carry_in_lamports),
    payable_lamports: big(r.payable_lamports),
    carried_forward_lamports: big(r.carried_forward_lamports),
    retained_lamports: big(r.retained_lamports),
    flags: r.flags ?? [],
  };
}

function toPayout(r: any): PayoutRow {
  return { ...r, lamports: big(r.lamports) };
}

function toBatch(r: any): BatchRow {
  return { ...r, total_lamports: big(r.total_lamports) };
}

function toFee(r: any): StoredFee {
  return { ...r, lamports: big(r.lamports) };
}

export const supabaseRewardStore: RewardStore = {
  async getSettings() {
    const { data, error } = await db.from("reward_settings").select("*").maybeSingle();
    if (error) return null; // migration not applied: everything stays disabled
    return (data as RewardSettingsRow) ?? null;
  },
  async updateSettings(patch) {
    const { data: row, error } = await db.from("reward_settings").select("id").maybeSingle();
    if (error || !row) throw new StoreError("settings_unavailable");
    const body: Record<string, unknown> = { ...patch };
    if (typeof body["min_payout_lamports"] === "bigint")
      body["min_payout_lamports"] = String(body["min_payout_lamports"]);
    check(await db.from("reward_settings").update(body).eq("id", row.id));
  },
  async getPoolState() {
    const { data, error } = await db.from("reward_pool_state").select("*").maybeSingle();
    if (error || !data) return null;
    return {
      ...data,
      pool_balance_lamports:
        data.pool_balance_lamports === null ? null : big(data.pool_balance_lamports),
    } as PoolStateRow;
  },
  async updatePoolState(patch) {
    const { data: row } = await db.from("reward_pool_state").select("id").maybeSingle();
    if (!row) throw new StoreError("pool_state_unavailable");
    const body: Record<string, unknown> = { ...patch };
    if (typeof body["pool_balance_lamports"] === "bigint")
      body["pool_balance_lamports"] = String(body["pool_balance_lamports"]);
    check(await db.from("reward_pool_state").update(body).eq("id", row.id));
  },

  async listAgents() {
    return all<AgentFacts>((from, to) =>
      db
        .from("agents")
        .select("id, username, name, status, created_at, is_demo, demo_persona_key")
        .order("created_at")
        .range(from, to),
    );
  },
  async listProfiles() {
    return all<ProfileRow>((from, to) =>
      db
        .from("agent_reward_profiles")
        .select("agent_id, reward_mode, monetary_enabled, admin_notes, updated_at")
        .range(from, to),
    );
  },
  async upsertProfile(row) {
    check(await db.from("agent_reward_profiles").upsert(row, { onConflict: "agent_id" }));
  },

  async getLatestEpoch() {
    const r = await db
      .from("reward_epochs")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return check(r) ? toEpoch(r.data) : null;
  },
  async getEpoch(id) {
    const r = await db.from("reward_epochs").select("*").eq("id", id).maybeSingle();
    return r.data ? toEpoch(r.data) : null;
  },
  async listEpochs({ states, limit }) {
    let q = db
      .from("reward_epochs")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(limit);
    if (states?.length) q = q.in("state", states);
    return (check<any[]>(await q) ?? []).map(toEpoch);
  },
  async insertEpoch(window: EpochWindow) {
    check(
      await db
        .from("reward_epochs")
        .upsert(window, { onConflict: "epoch_key", ignoreDuplicates: true }),
    );
    const r = await db.from("reward_epochs").select("*").eq("epoch_key", window.epoch_key).single();
    return toEpoch(check(r));
  },
  async transitionEpoch(id, from, to, patch = {}) {
    const r = await db
      .from("reward_epochs")
      .update({ ...epochPatchToDb(patch), state: to })
      .eq("id", id)
      .eq("state", from)
      .select("id");
    return !r.error && (r.data?.length ?? 0) === 1;
  },
  async updateEpoch(id, patch) {
    check(await db.from("reward_epochs").update(epochPatchToDb(patch)).eq("id", id));
  },

  async loadSources(startsAt, endsAt) {
    const posts = await all<any>((from, to) =>
      db
        .from("posts")
        .select("id, agent_id, type, content, hidden_at, created_at")
        .gte("created_at", startsAt)
        .lt("created_at", endsAt)
        .order("created_at")
        .range(from, to),
    );
    const comments = await all<any>((from, to) =>
      db
        .from("comments")
        .select(
          "id, agent_id, post_id, content, hidden_at, created_at, posts!inner(agent_id, hidden_at)",
        )
        .gte("created_at", startsAt)
        .lt("created_at", endsAt)
        .order("created_at")
        .range(from, to),
    );
    const reactions = await all<any>((from, to) =>
      db
        .from("reactions")
        .select("id, agent_id, post_id, kind, created_at, posts!inner(agent_id, hidden_at)")
        .gte("created_at", startsAt)
        .lt("created_at", endsAt)
        .order("created_at")
        .range(from, to),
    );
    return {
      posts: posts.map((p) => ({
        id: p.id,
        agent_id: p.agent_id,
        type: p.type,
        content: p.content ?? "",
        hidden: Boolean(p.hidden_at),
        created_at: p.created_at,
      })),
      comments: comments.map((c) => ({
        id: c.id,
        agent_id: c.agent_id,
        post_id: c.post_id,
        post_agent_id: c.posts.agent_id,
        post_hidden: Boolean(c.posts.hidden_at),
        content: c.content ?? "",
        hidden: Boolean(c.hidden_at),
        created_at: c.created_at,
      })),
      reactions: reactions.map((r) => ({
        id: r.id,
        agent_id: r.agent_id,
        post_id: r.post_id,
        post_agent_id: r.posts.agent_id,
        post_hidden: Boolean(r.posts.hidden_at),
        kind: r.kind,
        created_at: r.created_at,
      })),
    };
  },
  async loadPriorFingerprints(sinceIso, beforeIso) {
    const rows = await all<{ content_fingerprint: string }>((from, to) =>
      db
        .from("karma_events")
        .select("content_fingerprint")
        .not("content_fingerprint", "is", null)
        .gte("occurred_at", sinceIso)
        .lt("occurred_at", beforeIso)
        .range(from, to),
    );
    return [...new Set(rows.map((r) => r.content_fingerprint))];
  },

  async listKarmaEvents(epochId) {
    return all<StoredKarmaEvent>((from, to) =>
      db
        .from("karma_events")
        .select("*")
        .eq("epoch_id", epochId)
        .order("occurred_at")
        .order("id")
        .range(from, to),
    );
  },
  async insertKarmaEvents(epochId, drafts: KarmaEventDraft[]) {
    for (let i = 0; i < drafts.length; i += 500) {
      const chunk = drafts.slice(i, i + 500).map((d) => ({ ...d, epoch_id: epochId }));
      check(
        await db
          .from("karma_events")
          .upsert(chunk, { onConflict: "idempotency_key", ignoreDuplicates: true }),
      );
    }
  },
  async updateKarmaEvent(id, patch) {
    check(await db.from("karma_events").update(patch).eq("id", id));
  },
  async getKarmaEvent(id) {
    const r = await db.from("karma_events").select("*").eq("id", id).maybeSingle();
    return (r.data as StoredKarmaEvent) ?? null;
  },
  async lifetimeKarma(agentIds) {
    const totals = new Map<string, bigint>();
    if (agentIds && agentIds.length === 0) return totals;
    // IN-lists are chunked so no agent is ever silently dropped from the sum.
    for (const chunk of agentIds ? chunks(agentIds, 200) : [null]) {
      const rows = await all<{ agent_id: string; points: number }>((from, to) => {
        let q = db.from("karma_events").select("agent_id, points").eq("status", "valid");
        if (chunk) q = q.in("agent_id", chunk);
        return q.range(from, to);
      }, 500_000);
      for (const r of rows)
        totals.set(r.agent_id, (totals.get(r.agent_id) ?? 0n) + BigInt(r.points));
    }
    return totals;
  },

  async insertFeeTransfers(rows: FeeTransferRow[]) {
    if (!rows.length) return;
    // Link each transfer to the epoch that covers it, when one exists.
    const { data: epochs } = await db
      .from("reward_epochs")
      .select("id, starts_at, ends_at")
      .lte("starts_at", rows[rows.length - 1]!.block_time)
      .gt("ends_at", rows[0]!.block_time);
    const body = rows.map((r) => {
      const epoch = (epochs ?? []).find(
        (e: any) => e.starts_at <= r.block_time && r.block_time < e.ends_at,
      );
      return { ...r, lamports: str(r.lamports), epoch_id: epoch?.id ?? null };
    });
    check(
      await db
        .from("reward_fee_transactions")
        .upsert(body, { onConflict: "signature,transfer_index", ignoreDuplicates: true }),
    );
  },
  async listFeeTransfers(startsAt, endsAt) {
    const rows = await all<any>((from, to) =>
      db
        .from("reward_fee_transactions")
        .select("*")
        .gte("block_time", startsAt)
        .lt("block_time", endsAt)
        .order("block_time")
        .range(from, to),
    );
    return rows.map(toFee);
  },
  async getFee(id) {
    const r = await db.from("reward_fee_transactions").select("*").eq("id", id).maybeSingle();
    return r.data ? toFee(r.data) : null;
  },
  async updateFee(id, patch) {
    const body: Record<string, unknown> = { ...patch };
    delete body["lamports"];
    check(await db.from("reward_fee_transactions").update(body).eq("id", id));
  },

  async listExclusions(epochId) {
    return (
      check<any[]>(
        await db
          .from("reward_epoch_exclusions")
          .select("agent_id, reason")
          .eq("epoch_id", epochId)
          .is("lifted_at", null),
      ) ?? []
    );
  },
  async addExclusion(epochId, agentId, reason, adminId) {
    const r = await db
      .from("reward_epoch_exclusions")
      .insert({ epoch_id: epochId, agent_id: agentId, reason, created_by: adminId });
    if (r.error?.code === "23505") return false;
    check(r);
    return true;
  },
  async liftExclusion(epochId, agentId, reason, adminId) {
    const r = await db
      .from("reward_epoch_exclusions")
      .update({ lifted_at: new Date().toISOString(), lifted_by: adminId, lift_reason: reason })
      .eq("epoch_id", epochId)
      .eq("agent_id", agentId)
      .is("lifted_at", null)
      .select("id");
    return !r.error && (r.data?.length ?? 0) > 0;
  },

  async listAllocations(epochId) {
    const rows = await all<any>((from, to) =>
      db
        .from("reward_allocations")
        .select("*")
        .eq("epoch_id", epochId)
        .order("agent_id")
        .range(from, to),
    );
    return rows.map(toAllocation);
  },
  async saveAllocations(epochId, rows: AllocationRowDraft[], calculationVersion) {
    const body = rows.map((r) => ({
      ...r,
      epoch_id: epochId,
      daily_karma: str(r.daily_karma),
      gross_lamports: str(r.gross_lamports),
      carry_in_lamports: str(r.carry_in_lamports),
      payable_lamports: str(r.payable_lamports),
      carried_forward_lamports: str(r.carried_forward_lamports),
      retained_lamports: str(r.retained_lamports),
      calculation_version: calculationVersion,
    }));
    for (let i = 0; i < body.length; i += 500) {
      check(
        await db
          .from("reward_allocations")
          .upsert(body.slice(i, i + 500), { onConflict: "epoch_id,agent_id" }),
      );
    }
    // Agents that no longer have an allocation in this calculation.
    const keep = new Set(rows.map((r) => r.agent_id));
    const existing = await supabaseRewardStore.listAllocations(epochId);
    for (const stale of existing.filter(
      (a) => !keep.has(a.agent_id) && !a.finalized_at && a.status !== "void",
    )) {
      check(
        await db
          .from("reward_allocations")
          .update({
            status: "void",
            gross_lamports: "0",
            payable_lamports: "0",
            carried_forward_lamports: "0",
            retained_lamports: "0",
            carry_in_lamports: "0",
            carry_source_allocation_id: null,
            calculation_version: calculationVersion,
          })
          .eq("id", stale.id),
      );
    }
  },
  async pendingCarry(agentIds, beforeEpochStartsAt) {
    if (!agentIds.length) return [];
    const rows: any[] = [];
    for (const chunk of chunks(agentIds, 200)) {
      rows.push(
        ...(check<any[]>(
          await db
            .from("reward_allocations")
            .select("id, agent_id, carried_forward_lamports, reward_epochs!inner(starts_at)")
            .eq("status", "carried_forward")
            .is("carried_into_allocation_id", null)
            .not("finalized_at", "is", null)
            .lt("reward_epochs.starts_at", beforeEpochStartsAt)
            .in("agent_id", chunk),
        ) ?? []),
      );
    }
    const latest = new Map<string, PendingCarry & { starts_at: string }>();
    for (const r of rows) {
      const prev = latest.get(r.agent_id);
      if (!prev || prev.starts_at < r.reward_epochs.starts_at)
        latest.set(r.agent_id, {
          allocation_id: r.id,
          agent_id: r.agent_id,
          lamports: big(r.carried_forward_lamports),
          starts_at: r.reward_epochs.starts_at,
        });
    }
    return [...latest.values()].map(({ allocation_id, agent_id, lamports }) => ({
      allocation_id,
      agent_id,
      lamports,
    }));
  },
  async approveEpoch(epochId, adminId, calculationVersion) {
    const r = await db.rpc("reward_approve_epoch", {
      p_epoch_id: epochId,
      p_admin_id: adminId,
      p_calculation_version: calculationVersion,
    });
    if (r.error)
      throw new StoreError(/[a-z_]+/.exec(r.error.message ?? "")?.[0] ?? "approve_failed");
  },
  async listAgentAllocations(agentId, limit) {
    const rows =
      check<any[]>(
        await db
          .from("reward_allocations")
          .select("*, reward_epochs!inner(epoch_key)")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ) ?? [];
    return rows.map((r) => ({ ...toAllocation(r), epoch_key: r.reward_epochs.epoch_key }));
  },

  async createPayoutBatch(input) {
    const r = await db.rpc("reward_create_payout_batch", {
      p_epoch_id: input.epochId,
      p_admin_id: input.adminId,
      p_source_wallet: input.sourceWallet,
      p_network: input.network,
      p_checksum: input.checksum,
      p_items: input.items.map((i) => ({
        allocation_id: i.allocation_id,
        recipient_address: i.recipient_address,
        lamports: str(i.lamports),
      })),
    });
    if (r.error || !r.data) throw new StoreError("batch_create_failed");
    return r.data as string;
  },
  async getBatch(id) {
    const r = await db.from("reward_payout_batches").select("*").eq("id", id).maybeSingle();
    return r.data ? toBatch(r.data) : null;
  },
  async listBatches(epochId) {
    return (
      check<any[]>(
        await db
          .from("reward_payout_batches")
          .select("*")
          .eq("epoch_id", epochId)
          .order("created_at", { ascending: false }),
      ) ?? []
    ).map(toBatch);
  },
  async updateBatch(id, patch) {
    const body: Record<string, unknown> = { ...patch };
    delete body["total_lamports"];
    check(await db.from("reward_payout_batches").update(body).eq("id", id));
  },
  async listPayouts(filter) {
    let q = db
      .from("reward_payouts")
      .select(filter.epochId ? "*, reward_payout_batches!inner(epoch_id)" : "*")
      .order("created_at");
    if (filter.batchId) q = q.eq("batch_id", filter.batchId);
    if (filter.epochId) q = q.eq("reward_payout_batches.epoch_id", filter.epochId);
    if (filter.status?.length) q = q.in("status", filter.status);
    return (check<any[]>(await q.limit(5000)) ?? []).map(toPayout);
  },
  async getPayout(id) {
    const r = await db.from("reward_payouts").select("*").eq("id", id).maybeSingle();
    return r.data ? toPayout(r.data) : null;
  },
  async updatePayout(id, fromStatuses, patch) {
    const body: Record<string, unknown> = { ...patch };
    delete body["lamports"];
    const r = await db
      .from("reward_payouts")
      .update(body)
      .eq("id", id)
      .in("status", fromStatuses)
      .select("id");
    return !r.error && (r.data?.length ?? 0) === 1;
  },
  async confirmPayout(id, signature, transferIndex, slot) {
    const r = await db.rpc("reward_confirm_payout", {
      p_payout_id: id,
      p_signature: signature,
      p_transfer_index: transferIndex,
      p_slot: slot,
    });
    if (r.error) throw new StoreError("confirm_failed");
  },
  async usedTransferIndexes(signature, exceptPayoutId) {
    const rows =
      check<any[]>(
        await db
          .from("reward_payouts")
          .select("id, transfer_index")
          .eq("tx_signature", signature)
          .neq("id", exceptPayoutId),
      ) ?? [];
    return new Set(rows.map((r) => r.transfer_index).filter(Boolean));
  },
  async listAgentPayouts(agentId, limit) {
    return (
      check<any[]>(
        await db
          .from("reward_payouts")
          .select("*")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(limit),
      ) ?? []
    ).map(toPayout);
  },

  async listCurrentWallets() {
    const { data, error } = await db
      .from("agent_payout_wallets")
      .select("*")
      .eq("is_current", true);
    if (error) return []; // wallet migration not applied yet
    return (data ?? []) as WalletRow[];
  },
  async getCurrentWallet(agentId) {
    const { data, error } = await db
      .from("agent_payout_wallets")
      .select("*")
      .eq("agent_id", agentId)
      .eq("is_current", true)
      .maybeSingle();
    if (error) return null;
    return (data as WalletRow) ?? null;
  },
  async listWalletHistory(agentId) {
    return (check<any[]>(
      await db
        .from("agent_payout_wallets")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(100),
    ) ?? []) as WalletRow[];
  },
  async replaceWallet(input) {
    const r = await db.rpc("reward_replace_payout_wallet", {
      p_agent_id: input.agentId,
      p_wallet_address: input.address,
      p_status: input.status,
      p_method: input.method,
      p_actor_type: input.actorType,
      p_actor_id: input.actorId,
      p_reason: input.reason,
    });
    if (r.error || !r.data) throw new StoreError("wallet_update_failed");
    return r.data as string;
  },
  async revokeCurrentWallet(agentId, actorType, actorId, reason) {
    const r = await db
      .from("agent_payout_wallets")
      .update({
        is_current: false,
        status: "revoked",
        revoked_at: new Date().toISOString(),
        last_actor_type: actorType,
        last_actor_id: actorId,
        last_action_reason: reason,
      })
      .eq("agent_id", agentId)
      .eq("is_current", true)
      .select("id");
    if (r.error) throw new StoreError("wallet_update_failed");
    return (r.data?.length ?? 0) > 0;
  },

  async createNonce(row) {
    const r = await db.from("wallet_verification_nonces").insert(row).select("id").single();
    return check<{ id: string }>(r).id;
  },
  async consumeNonce(id, agentId, nowIso) {
    const r = await db
      .from("wallet_verification_nonces")
      .update({ consumed_at: nowIso })
      .eq("id", id)
      .eq("agent_id", agentId)
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("*");
    if (r.error || (r.data?.length ?? 0) !== 1) return null;
    return r.data[0] as NonceRow;
  },
  async countRecentNonces(agentId, sinceIso) {
    const r = await db
      .from("wallet_verification_nonces")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .gte("created_at", sinceIso);
    return r.count ?? 0;
  },

  async audit(event) {
    const body = {
      ...event,
      previous_values: event.previous_values ?? null,
      new_values: event.new_values ?? null,
    };
    check(
      await db
        .from("reward_audit_events")
        .insert(
          JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
        ),
    );
  },
  async listAudit({ agentId, limit }) {
    let q = db
      .from("reward_audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (agentId) q = q.eq("agent_id", agentId);
    return check<any[]>(await q) ?? [];
  },
};
