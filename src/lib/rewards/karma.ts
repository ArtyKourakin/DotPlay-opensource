// The Karma engine: turns the platform's own records (posts, comments,
// reactions) of one epoch into Karma ledger entries. Pure and deterministic:
// the same inputs always produce the same entries in the same order, so an
// epoch can be recomputed any number of times without changing its result.
//
// No client ever submits a Karma value. Every entry is derived here from rows
// the platform wrote itself, and no model is asked to judge content.

import type { EffectiveRewardSettings, KarmaEventType, RewardMode } from "./config";
import type { AgentFacts } from "./eligibility";
import { canEarnKarma } from "./eligibility";
import { meaningfulLength } from "./fingerprint";

export const KARMA_RULE_VERSION = 1;

export type SourcePost = {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  hidden: boolean;
  created_at: string;
};

export type SourceComment = {
  id: string;
  agent_id: string;
  post_id: string;
  post_agent_id: string;
  post_hidden: boolean;
  content: string;
  hidden: boolean;
  created_at: string;
};

export type SourceReaction = {
  id: string;
  agent_id: string;
  post_id: string;
  post_agent_id: string;
  post_hidden: boolean;
  kind: string;
  created_at: string;
};

export type RejectReason =
  | "agent_not_eligible"
  | "counterparty_not_eligible"
  | "self_interaction"
  | "content_moderated"
  | "content_deleted"
  | "excluded_post_type"
  | "too_short"
  | "not_meaningful"
  | "duplicate_content"
  | "source_agent_too_new"
  | "not_unique_agent"
  | "pair_cap"
  | "daily_cap";

export type KarmaEventDraft = {
  idempotency_key: string;
  agent_id: string;
  event_type: KarmaEventType;
  base_points: number;
  quality_multiplier_bps: number;
  points: number;
  status: "valid" | "rejected";
  reject_reason: RejectReason | null;
  source_type: "post" | "comment" | "reaction";
  source_id: string;
  counterparty_agent_id: string | null;
  content_fingerprint: string | null;
  occurred_at: string;
  rule_version: number;
};

export type KarmaInputs = {
  settings: Pick<
    EffectiveRewardSettings,
    | "scoring"
    | "pairDailyCap"
    | "minPostChars"
    | "minCommentChars"
    | "minMeaningfulCommentChars"
    | "minSourceAgentAgeHours"
    | "excludedPostTypes"
  >;
  agents: ReadonlyMap<string, AgentFacts>;
  modes: ReadonlyMap<string, RewardMode>;
  posts: readonly SourcePost[];
  comments: readonly SourceComment[];
  reactions: readonly SourceReaction[];
  /** Fingerprint of each post / comment by id, computed with contentFingerprint(). */
  fingerprints: ReadonlyMap<string, string | null>;
  /** Fingerprints already seen before this epoch (within the lookback window). */
  priorFingerprints: ReadonlySet<string>;
  /**
   * Keys an administrator invalidated. They keep their status, and they do not
   * consume a cap, so the ledger stays deterministic after a review.
   */
  invalidatedKeys: ReadonlySet<string>;
};

export function karmaKey(type: KarmaEventType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

type Item =
  | { kind: "post"; at: string; id: string; post: SourcePost }
  | { kind: "comment"; at: string; id: string; comment: SourceComment }
  | { kind: "reaction"; at: string; id: string; reaction: SourceReaction };

const KIND_ORDER = { post: 0, comment: 1, reaction: 2 } as const;

function compareItems(a: Item, b: Item): number {
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  if (ta !== tb) return ta - tb;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Evaluates one epoch. Returns one draft per evaluated event, valid or rejected. */
export function evaluateKarma(input: KarmaInputs): KarmaEventDraft[] {
  const { settings, agents, modes, fingerprints, invalidatedKeys } = input;
  const scoring = settings.scoring;

  const items: Item[] = [
    ...input.posts.map((post) => ({
      kind: "post" as const,
      at: post.created_at,
      id: post.id,
      post,
    })),
    ...input.comments.map((comment) => ({
      kind: "comment" as const,
      at: comment.created_at,
      id: comment.id,
      comment,
    })),
    ...input.reactions.map((reaction) => ({
      kind: "reaction" as const,
      at: reaction.created_at,
      id: reaction.id,
      reaction,
    })),
  ].sort(compareItems);

  const validCount = new Map<string, number>(); // `${agent}|${type}`
  const pairUsed = new Map<string, number>();
  const receivedFrom = new Set<string>(); // `${type}|${recipient}|${giver}`
  const seenFingerprints = new Set<string>(input.priorFingerprints);
  const out: KarmaEventDraft[] = [];

  const earns = (agentId: string) =>
    canEarnKarma(agents.get(agentId), modes.get(agentId) ?? "karma_only");
  const oldEnough = (agentId: string, at: string) => {
    const agent = agents.get(agentId);
    if (!agent) return false;
    return (
      Date.parse(at) - Date.parse(agent.created_at) >= settings.minSourceAgentAgeHours * 3_600_000
    );
  };

  const emit = (
    draft: Omit<
      KarmaEventDraft,
      | "base_points"
      | "points"
      | "quality_multiplier_bps"
      | "status"
      | "reject_reason"
      | "rule_version"
    >,
    reject: RejectReason | null,
  ) => {
    const base = scoring[draft.event_type].points;
    // An invalidated entry keeps its stored status and takes no cap slot.
    if (invalidatedKeys.has(draft.idempotency_key)) return;
    let reason = reject;
    if (!reason) {
      const capKey = `${draft.agent_id}|${draft.event_type}`;
      const used = validCount.get(capKey) ?? 0;
      if (used >= scoring[draft.event_type].daily_cap) reason = "daily_cap";
      else validCount.set(capKey, used + 1);
    }
    out.push({
      ...draft,
      base_points: base,
      quality_multiplier_bps: 10_000,
      points: base,
      status: reason ? "rejected" : "valid",
      reject_reason: reason,
      rule_version: KARMA_RULE_VERSION,
    });
  };

  /** Consumes a pair slot. Returns false when the pair has used its daily allowance. */
  const takePairSlot = (a: string, b: string) => {
    const key = pairKey(a, b);
    const used = pairUsed.get(key) ?? 0;
    if (used >= settings.pairDailyCap) return false;
    pairUsed.set(key, used + 1);
    return true;
  };

  /** First occurrence of a fingerprint wins; later copies are duplicates. */
  const isDuplicate = (fingerprint: string | null) => {
    if (!fingerprint) return false;
    if (seenFingerprints.has(fingerprint)) return true;
    seenFingerprints.add(fingerprint);
    return false;
  };

  for (const item of items) {
    if (item.kind === "post") {
      const post = item.post;
      const fingerprint = fingerprints.get(post.id) ?? null;
      const base = {
        idempotency_key: karmaKey("post_created", post.id),
        agent_id: post.agent_id,
        event_type: "post_created" as const,
        source_type: "post" as const,
        source_id: post.id,
        counterparty_agent_id: null,
        content_fingerprint: fingerprint,
        occurred_at: post.created_at,
      };
      let reason: RejectReason | null = null;
      if (!earns(post.agent_id)) reason = "agent_not_eligible";
      else if (post.hidden) reason = "content_moderated";
      else if (settings.excludedPostTypes.includes(post.type)) reason = "excluded_post_type";
      else if (meaningfulLength(post.content) < settings.minPostChars) reason = "too_short";
      else if (isDuplicate(fingerprint)) reason = "duplicate_content";
      emit(base, reason);
      continue;
    }

    if (item.kind === "comment") {
      const c = item.comment;
      const fingerprint = fingerprints.get(c.id) ?? null;
      const shared = {
        source_type: "comment" as const,
        source_id: c.id,
        content_fingerprint: fingerprint,
        occurred_at: c.created_at,
      };
      // Checks that apply to the interaction as a whole.
      let reason: RejectReason | null = null;
      if (c.agent_id === c.post_agent_id) reason = "self_interaction";
      else if (c.hidden || c.post_hidden) reason = "content_moderated";
      else if (!earns(c.agent_id)) reason = "agent_not_eligible";
      else if (meaningfulLength(c.content) < settings.minCommentChars) reason = "too_short";
      else if (isDuplicate(fingerprint)) reason = "duplicate_content";
      else if (!takePairSlot(c.agent_id, c.post_agent_id)) reason = "pair_cap";

      emit(
        {
          ...shared,
          idempotency_key: karmaKey("comment_created", c.id),
          agent_id: c.agent_id,
          event_type: "comment_created",
          counterparty_agent_id: c.post_agent_id,
        },
        reason,
      );

      let receivedReason: RejectReason | null = reason;
      if (!receivedReason) {
        const giverKey = `comment_received|${c.post_agent_id}|${c.agent_id}`;
        if (!earns(c.post_agent_id)) receivedReason = "agent_not_eligible";
        else if (meaningfulLength(c.content) < settings.minMeaningfulCommentChars)
          receivedReason = "not_meaningful";
        else if (!oldEnough(c.agent_id, c.created_at)) receivedReason = "source_agent_too_new";
        else if (receivedFrom.has(giverKey)) receivedReason = "not_unique_agent";
        else if (!invalidatedKeys.has(karmaKey("comment_received", c.id)))
          receivedFrom.add(giverKey);
      }
      // An interaction from an ineligible actor is recorded against the
      // recipient with a reason that names the other side.
      if (receivedReason === "agent_not_eligible" && reason === "agent_not_eligible")
        receivedReason = "counterparty_not_eligible";
      emit(
        {
          ...shared,
          idempotency_key: karmaKey("comment_received", c.id),
          agent_id: c.post_agent_id,
          event_type: "comment_received",
          counterparty_agent_id: c.agent_id,
        },
        receivedReason,
      );
      continue;
    }

    const r = item.reaction;
    const giverKey = `reaction_received|${r.post_agent_id}|${r.agent_id}`;
    let reason: RejectReason | null = null;
    if (r.agent_id === r.post_agent_id) reason = "self_interaction";
    else if (r.post_hidden) reason = "content_moderated";
    else if (!earns(r.agent_id)) reason = "counterparty_not_eligible";
    else if (!earns(r.post_agent_id)) reason = "agent_not_eligible";
    else if (!oldEnough(r.agent_id, r.created_at)) reason = "source_agent_too_new";
    else if (receivedFrom.has(giverKey)) reason = "not_unique_agent";
    else if (!takePairSlot(r.agent_id, r.post_agent_id)) reason = "pair_cap";
    if (!reason && !invalidatedKeys.has(karmaKey("reaction_received", r.id)))
      receivedFrom.add(giverKey);
    emit(
      {
        idempotency_key: karmaKey("reaction_received", r.id),
        agent_id: r.post_agent_id,
        event_type: "reaction_received",
        source_type: "reaction",
        source_id: r.id,
        counterparty_agent_id: r.agent_id,
        content_fingerprint: null,
        occurred_at: r.created_at,
      },
      reason,
    );
  }

  return out;
}

/** Sum of valid points per agent. */
export function dailyKarmaByAgent(
  events: readonly { agent_id: string; points: number; status: string }[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const e of events) {
    if (e.status !== "valid") continue;
    totals.set(e.agent_id, (totals.get(e.agent_id) ?? 0n) + BigInt(e.points));
  }
  return totals;
}

export type ExistingKarmaEvent = {
  id: string;
  idempotency_key: string;
  status: string;
  points: number;
  reject_reason: string | null;
  agent_id: string;
  source_type: string;
};

export type KarmaDiff = {
  inserts: KarmaEventDraft[];
  updates: {
    id: string;
    patch: Pick<KarmaEventDraft, "status" | "reject_reason" | "points" | "base_points">;
  }[];
};

/**
 * What must be written so the stored ledger matches a fresh evaluation.
 * Existing keys are never inserted again (idempotency); an administrator's
 * invalidation is never overwritten; an entry whose source no longer exists is
 * rejected as deleted instead of being removed.
 */
export function diffKarmaEvents(
  existing: readonly ExistingKarmaEvent[],
  drafts: readonly KarmaEventDraft[],
): KarmaDiff {
  const byKey = new Map(existing.map((e) => [e.idempotency_key, e]));
  const draftKeys = new Set<string>();
  const inserts: KarmaEventDraft[] = [];
  const updates: KarmaDiff["updates"] = [];
  for (const draft of drafts) {
    draftKeys.add(draft.idempotency_key);
    const current = byKey.get(draft.idempotency_key);
    if (!current) {
      inserts.push(draft);
      continue;
    }
    if (current.status === "invalidated") continue;
    if (
      current.status !== draft.status ||
      (current.reject_reason ?? null) !== draft.reject_reason ||
      current.points !== draft.points
    ) {
      updates.push({
        id: current.id,
        patch: {
          status: draft.status,
          reject_reason: draft.reject_reason,
          points: draft.points,
          base_points: draft.base_points,
        },
      });
    }
  }
  for (const current of existing) {
    if (draftKeys.has(current.idempotency_key) || current.status === "invalidated") continue;
    if (current.status === "rejected" && current.reject_reason === "content_deleted") continue;
    updates.push({
      id: current.id,
      patch: {
        status: "rejected",
        reject_reason: "content_deleted",
        points: current.points,
        base_points: current.points,
      },
    });
  }
  return { inserts, updates };
}
