// Proportional reward allocation in integer lamports with share caps. Pure.
//
//   Agent Reward = Pool × Agent Daily Karma ÷ Total Eligible Daily Karma
//
// subject to three caps:
//   * no agent above maxAgentShareBps of the pool;
//   * no payout wallet (all agents sharing it together) above maxWalletShareBps;
//   * pilot agents together no more than pilotAggregateShareBps.
//
// When a cap binds, the excess is redistributed proportionally among the
// participants that still have room (water-filling). Whatever cannot be placed,
// and every rounding remainder, stays in the Reward Pool. No floating point is
// used anywhere: all comparisons are exact BigInt cross-multiplications and the
// only rounding is a floor, so the total can never exceed the pool.

import { BPS_DENOMINATOR } from "./config";

export type Participant = {
  agentId: string;
  karma: bigint;
  /** Payout wallet address, or null when none is verified (no wallet group). */
  walletKey: string | null;
  isPilot: boolean;
};

export type AllocationCaps = {
  maxAgentShareBps: number;
  maxWalletShareBps: number;
  pilotAggregateShareBps: number;
};

export type CapKind = "agent" | "wallet" | "pilot_group" | "safety";

export type AllocationResult = {
  amounts: Map<string, bigint>;
  cappedBy: Map<string, CapKind>;
  allocated: bigint;
  remainder: bigint;
};

type Group = { key: string; kind: CapKind; members: string[]; cap: bigint };

function capOf(pool: bigint, bps: number): bigint {
  return (pool * BigInt(bps)) / BPS_DENOMINATOR;
}

function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

/**
 * Water-filling over `members` with a budget, individual caps and group caps.
 * Groups passed here are already restricted to `members`, with their caps
 * reduced by what is already fixed outside this call.
 */
function waterFill(
  budget: bigint,
  members: string[],
  karma: ReadonlyMap<string, bigint>,
  individualCap: ReadonlyMap<string, bigint>,
  groups: Group[],
  cappedBy: Map<string, CapKind>,
  depth = 0,
): Map<string, bigint> {
  const fixed = new Map<string, bigint>();
  let active = sortedIds(members.filter((id) => (karma.get(id) ?? 0n) > 0n));
  for (const id of members) if ((karma.get(id) ?? 0n) <= 0n) fixed.set(id, 0n);
  let remaining = budget > 0n ? budget : 0n;

  const fixedIn = (group: Group) =>
    group.members.reduce((sum, id) => sum + (fixed.get(id) ?? 0n), 0n);

  // Each iteration fixes at least one participant, so this terminates.
  for (let guard = 0; guard <= members.length + groups.length + 1 && active.length > 0; guard++) {
    const K = active.reduce((sum, id) => sum + (karma.get(id) ?? 0n), 0n);
    if (K === 0n || remaining === 0n) break;

    // Tentative share of an active member, scaled by K and already limited by
    // its individual cap:  min(R·k, cap·K)  (= K × min(R·k/K, cap)).
    const cappedDemand = (id: string) => {
      const want = remaining * (karma.get(id) ?? 0n);
      const cap = individualCap.get(id);
      return cap !== undefined && want > cap * K ? cap * K : want;
    };

    // 1. Group caps. A group whose fixed amount plus its members' capped
    //    demand exceeds its cap will be bound by that cap in the final result
    //    (fixing others only raises everyone's share), so it is settled now.
    //    The most over-subscribed group goes first (ties broken by key), which
    //    keeps the result deterministic.
    let worst: { group: Group; overNum: bigint; overDen: bigint } | null = null;
    for (const group of groups) {
      const activeMembers = group.members.filter((id) => active.includes(id));
      if (activeMembers.length === 0) continue;
      const demand = activeMembers.reduce((sum, id) => sum + cappedDemand(id), 0n);
      // (fixedIn + demand/K) > cap  ⇔  fixedIn·K + demand > cap·K
      const lhs = fixedIn(group) * K + demand;
      const rhs = group.cap * K;
      if (lhs <= rhs) continue;
      // Compare over-subscription ratios lhs/rhs exactly (rhs may be 0).
      if (
        !worst ||
        lhs * worst.overDen > worst.overNum * (rhs === 0n ? 1n : rhs) ||
        (lhs * worst.overDen === worst.overNum * (rhs === 0n ? 1n : rhs) &&
          group.key < worst.group.key)
      ) {
        worst = { group, overNum: lhs, overDen: rhs === 0n ? 1n : rhs };
      }
    }
    if (worst) {
      const group = worst.group;
      const inside = group.members.filter((id) => active.includes(id));
      const groupBudget = group.cap - fixedIn(group);
      const budgetForGroup =
        groupBudget > 0n ? (groupBudget < remaining ? groupBudget : remaining) : 0n;
      // Other groups, restricted to this group's active members.
      const nested = groups
        .filter((g) => g !== group)
        .map((g) => ({
          ...g,
          members: g.members.filter((id) => inside.includes(id)),
          cap: g.cap - fixedIn(g),
        }))
        .filter((g) => g.members.length > 0);
      const inner =
        depth < 4
          ? waterFill(budgetForGroup, inside, karma, individualCap, nested, cappedBy, depth + 1)
          : proportional(budgetForGroup, inside, karma);
      for (const id of inside) {
        const amount = inner.get(id) ?? 0n;
        fixed.set(id, amount);
        if (!cappedBy.has(id)) cappedBy.set(id, group.kind);
        remaining -= amount;
      }
      active = active.filter((id) => !inside.includes(id));
      continue;
    }

    // 2. Individual caps: tentative share R·k/K above the cap ⇔ R·k > cap·K.
    const overCap = active.filter((id) => {
      const cap = individualCap.get(id);
      return cap !== undefined && remaining * (karma.get(id) ?? 0n) > cap * K;
    });
    if (overCap.length > 0) {
      for (const id of overCap) {
        const cap = individualCap.get(id) ?? 0n;
        fixed.set(id, cap);
        cappedBy.set(id, "agent");
        remaining -= cap;
      }
      active = active.filter((id) => !overCap.includes(id));
      continue;
    }

    // 3. Nothing binds: floor-proportional split of what remains.
    const shares = proportional(remaining, active, karma);
    for (const id of active) fixed.set(id, shares.get(id) ?? 0n);
    active = [];
  }
  for (const id of active) if (!fixed.has(id)) fixed.set(id, 0n);
  return fixed;
}

function proportional(
  budget: bigint,
  ids: string[],
  karma: ReadonlyMap<string, bigint>,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const K = ids.reduce((sum, id) => sum + (karma.get(id) ?? 0n), 0n);
  for (const id of ids)
    out.set(id, K === 0n || budget <= 0n ? 0n : (budget * (karma.get(id) ?? 0n)) / K);
  return out;
}

export function allocateRewardPool(
  pool: bigint,
  participants: readonly Participant[],
  caps: AllocationCaps,
): AllocationResult {
  const amounts = new Map<string, bigint>();
  const cappedBy = new Map<string, CapKind>();
  if (pool <= 0n || participants.length === 0) {
    for (const p of participants) amounts.set(p.agentId, 0n);
    return { amounts, cappedBy, allocated: 0n, remainder: pool > 0n ? pool : 0n };
  }

  const ids = sortedIds(new Set(participants.map((p) => p.agentId)));
  const karma = new Map<string, bigint>();
  for (const p of participants)
    karma.set(p.agentId, (karma.get(p.agentId) ?? 0n) + (p.karma > 0n ? p.karma : 0n));

  const agentCap = capOf(pool, caps.maxAgentShareBps);
  const individualCap = new Map(ids.map((id) => [id, agentCap]));

  const groups: Group[] = [];
  const byWallet = new Map<string, string[]>();
  for (const p of participants) {
    if (!p.walletKey) continue;
    byWallet.set(p.walletKey, [...(byWallet.get(p.walletKey) ?? []), p.agentId]);
  }
  const walletCap = capOf(pool, caps.maxWalletShareBps);
  for (const [key, members] of [...byWallet.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    groups.push({
      key: `wallet:${key}`,
      kind: "wallet",
      members: sortedIds(members),
      cap: walletCap,
    });
  }
  const pilots = sortedIds(participants.filter((p) => p.isPilot).map((p) => p.agentId));
  if (pilots.length > 0 && caps.pilotAggregateShareBps < 10_000) {
    groups.push({
      key: "pilot",
      kind: "pilot_group",
      members: pilots,
      cap: capOf(pool, caps.pilotAggregateShareBps),
    });
  }

  const result = waterFill(pool, ids, karma, individualCap, groups, cappedBy);
  for (const id of ids) amounts.set(id, result.get(id) ?? 0n);

  // Safety net: if any cap is still exceeded (a pathological overlap of groups),
  // scale that group down. Money is only ever withheld, never over-paid.
  for (const id of ids) {
    if ((amounts.get(id) ?? 0n) > agentCap) {
      amounts.set(id, agentCap);
      cappedBy.set(id, "safety");
    }
  }
  for (const group of groups) {
    const sum = group.members.reduce((s, id) => s + (amounts.get(id) ?? 0n), 0n);
    if (sum > group.cap && sum > 0n) {
      for (const id of group.members) {
        amounts.set(id, ((amounts.get(id) ?? 0n) * group.cap) / sum);
        cappedBy.set(id, "safety");
      }
    }
  }
  let allocated = 0n;
  for (const v of amounts.values()) allocated += v;
  if (allocated > pool) {
    // Unreachable by construction; refuse to over-allocate regardless.
    throw new Error("allocation_exceeds_pool");
  }
  return { amounts, cappedBy, allocated, remainder: pool - allocated };
}

/** Daily Reward Pool = floor(eligible net fees × distribution bps ÷ 10 000). */
export function rewardPoolFromFees(feeLamports: bigint, distributionBps: number): bigint {
  if (feeLamports <= 0n) return 0n;
  return (feeLamports * BigInt(distributionBps)) / BPS_DENOMINATOR;
}
