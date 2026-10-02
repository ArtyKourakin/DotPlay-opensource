import { describe, expect, test } from "bun:test";
import { allocateRewardPool, rewardPoolFromFees, type Participant } from "../allocation";
import { DEFAULT_SETTINGS_ROW, DISABLED_ENV, formatSol, resolveEffectiveSettings } from "../config";
import { computeDistribution, type DistributionInput } from "../distribution";
import type { PayoutWallet, RewardProfile } from "../eligibility";
import { agent } from "./fakes";

const NO_CAPS = {
  maxAgentShareBps: 10000,
  maxWalletShareBps: 10000,
  pilotAggregateShareBps: 10000,
};
const p = (
  agentId: string,
  karma: number,
  walletKey: string | null = `w-${agentId}`,
  isPilot = false,
): Participant => ({
  agentId,
  karma: BigInt(karma),
  walletKey,
  isPilot,
});
const sum = (m: Map<string, bigint>) => [...m.values()].reduce((s, v) => s + v, 0n);

describe("reward pool", () => {
  test("the Daily Reward Pool is 50% of eligible fees by default", () => {
    const settings = resolveEffectiveSettings(
      { ...DEFAULT_SETTINGS_ROW, karma_enabled: true },
      { ...DISABLED_ENV, rewardsEnabled: true },
    );
    expect(settings.distributionBps).toBe(5000);
    expect(rewardPoolFromFees(1_000_000_001n, settings.distributionBps)).toBe(500_000_000n);
  });
  test("integer lamports only: odd amounts floor, never round up", () => {
    expect(rewardPoolFromFees(3n, 5000)).toBe(1n);
    expect(rewardPoolFromFees(0n, 5000)).toBe(0n);
    expect(rewardPoolFromFees(-5n, 5000)).toBe(0n);
    expect(formatSol(1_500_000_001n)).toBe("1.500000001");
  });
  test("an environment ceiling lowers the admin percentage", () => {
    const s = resolveEffectiveSettings(
      { ...DEFAULT_SETTINGS_ROW, distribution_bps: 7000 },
      { ...DISABLED_ENV, maxDistributionBps: 5000 },
    );
    expect(s.distributionBps).toBe(5000);
  });
});

describe("proportional allocation", () => {
  test("shares follow Daily Karma exactly", () => {
    const r = allocateRewardPool(1000n, [p("a", 10), p("b", 30)], NO_CAPS);
    expect(r.amounts.get("a")).toBe(250n);
    expect(r.amounts.get("b")).toBe(750n);
    expect(r.remainder).toBe(0n);
  });
  test("rounding is deterministic and the remainder stays in the pool", () => {
    const r = allocateRewardPool(100n, [p("a", 1), p("b", 1), p("c", 1)], NO_CAPS);
    expect([...r.amounts.values()]).toEqual([33n, 33n, 33n]);
    expect(r.remainder).toBe(1n);
    const again = allocateRewardPool(100n, [p("c", 1), p("a", 1), p("b", 1)], NO_CAPS);
    expect([...again.amounts.entries()].sort()).toEqual([...r.amounts.entries()].sort());
  });
  test("nothing is allocated from an empty pool or without participants", () => {
    expect(allocateRewardPool(0n, [p("a", 5)], NO_CAPS).allocated).toBe(0n);
    expect(allocateRewardPool(100n, [], NO_CAPS).remainder).toBe(100n);
  });
});

describe("share caps", () => {
  const caps = { maxAgentShareBps: 1500, maxWalletShareBps: 10000, pilotAggregateShareBps: 10000 };
  test("no agent receives more than 15% and the excess is redistributed proportionally", () => {
    const participants = [
      p("whale", 1000),
      ...Array.from({ length: 10 }, (_, i) => p(`s${i}`, 10 + i)),
    ];
    const r = allocateRewardPool(1_000_000n, participants, caps);
    expect(r.amounts.get("whale")).toBe(150_000n);
    expect(r.cappedBy.get("whale")).toBe("agent");
    // The rest share 850 000 in proportion to their Karma.
    const rest = participants.slice(1);
    const restKarma = rest.reduce((s, x) => s + x.karma, 0n);
    for (const x of rest) expect(r.amounts.get(x.agentId)).toBe((850_000n * x.karma) / restKarma);
    expect(r.allocated + r.remainder).toBe(1_000_000n);
  });
  test("with only three agents every share is capped and the rest stays in the pool", () => {
    const r = allocateRewardPool(1_000_000n, [p("a", 50), p("b", 30), p("c", 20)], caps);
    expect([...r.amounts.values()]).toEqual([150_000n, 150_000n, 150_000n]);
    expect(r.remainder).toBe(550_000n);
  });
  test("agents sharing one payout wallet are capped together and the excess is redistributed", () => {
    const walletCaps = {
      maxAgentShareBps: 10000,
      maxWalletShareBps: 2000,
      pilotAggregateShareBps: 10000,
    };
    const others = ["t", "u", "v", "x", "y", "z"].map((id) => p(id, 10, `w${id}`));
    const r = allocateRewardPool(
      1_000_000n,
      [p("s1", 40, "shared"), p("s2", 40, "shared"), ...others],
      walletCaps,
    );
    expect((r.amounts.get("s1") ?? 0n) + (r.amounts.get("s2") ?? 0n)).toBe(200_000n);
    expect(r.amounts.get("s1")).toBe(100_000n);
    expect(r.cappedBy.get("s1")).toBe("wallet");
    // The 600 000 the shared wallet could not take goes to the others.
    for (const o of others) expect(r.amounts.get(o.agentId)).toBe(133_333n);
    expect(r.remainder).toBe(2n);
  });
  test("wallet cap and agent cap together still place the excess with the others", () => {
    const both = { maxAgentShareBps: 1500, maxWalletShareBps: 1500, pilotAggregateShareBps: 10000 };
    const participants = [
      p("s1", 100, "shared"),
      p("s2", 100, "shared"),
      ...Array.from({ length: 12 }, (_, i) => p(`o${i}`, 10)),
    ];
    const r = allocateRewardPool(10_000_000n, participants, both);
    expect((r.amounts.get("s1") ?? 0n) + (r.amounts.get("s2") ?? 0n)).toBeLessThanOrEqual(
      1_500_000 as never,
    );
    expect((r.amounts.get("s1") ?? 0n) + (r.amounts.get("s2") ?? 0n)).toBe(1_500_000n);
    for (let i = 0; i < 12; i++) expect(r.amounts.get(`o${i}`)).toBe(708_333n);
  });
  test("a separate aggregate cap limits pilot agents together", () => {
    const pilotCap = {
      maxAgentShareBps: 10000,
      maxWalletShareBps: 10000,
      pilotAggregateShareBps: 3000,
    };
    const r = allocateRewardPool(
      1_000_000n,
      [p("p1", 50, "w1", true), p("p2", 50, "w2", true), p("x", 100)],
      pilotCap,
    );
    expect((r.amounts.get("p1") ?? 0n) + (r.amounts.get("p2") ?? 0n)).toBe(300_000n);
    expect(r.amounts.get("x")).toBe(700_000n);
  });
  test("randomised inputs never exceed a cap or the pool", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 300; round++) {
      const n = 1 + Math.floor(rand() * 25);
      const wallets = ["w1", "w2", "w3", null];
      const participants = Array.from({ length: n }, (_, i) =>
        p(
          `a${i}`,
          1 + Math.floor(rand() * 500),
          wallets[Math.floor(rand() * wallets.length)] ?? null,
          rand() < 0.3,
        ),
      );
      const c = {
        maxAgentShareBps: 100 + Math.floor(rand() * 9900),
        maxWalletShareBps: 100 + Math.floor(rand() * 9900),
        pilotAggregateShareBps: Math.floor(rand() * 10001),
      };
      const pool = BigInt(Math.floor(rand() * 1e12));
      const r = allocateRewardPool(pool, participants, c);
      expect(r.allocated + r.remainder).toBe(pool);
      expect(r.remainder >= 0n).toBe(true);
      const agentCap = (pool * BigInt(c.maxAgentShareBps)) / 10000n;
      for (const v of r.amounts.values()) expect(v <= agentCap).toBe(true);
      for (const w of ["w1", "w2", "w3"]) {
        const members = participants.filter((x) => x.walletKey === w);
        const total = members.reduce((s, x) => s + (r.amounts.get(x.agentId) ?? 0n), 0n);
        expect(total <= (pool * BigInt(c.maxWalletShareBps)) / 10000n).toBe(true);
      }
      if (c.pilotAggregateShareBps < 10000) {
        const pilots = participants
          .filter((x) => x.isPilot)
          .reduce((s, x) => s + (r.amounts.get(x.agentId) ?? 0n), 0n);
        expect(pilots <= (pool * BigInt(c.pilotAggregateShareBps)) / 10000n).toBe(true);
      }
      // Determinism: the same participants in reverse order give the same result.
      const again = allocateRewardPool(pool, [...participants].reverse(), c);
      expect(sum(again.amounts)).toBe(sum(r.amounts));
      for (const [k, v] of r.amounts) expect(again.amounts.get(k)).toBe(v);
    }
  });
});

const SETTINGS: DistributionInput["settings"] = {
  distributionBps: 5000,
  maxAgentShareBps: 10000,
  maxWalletShareBps: 10000,
  pilotAggregateShareBps: 10000,
  pilotPayoutsEnabled: true,
  publicPayoutsEnabled: true,
  minAgentAgeHours: 24,
  minDailyKarma: 10,
  minPayoutLamports: 1_000n,
};
const EPOCH = { starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-10-02T00:00:00.000Z" };
const wallet = (
  agentId: string,
  status: PayoutWallet["status"] = "signature_verified",
  address = `Wallet${agentId}`,
): PayoutWallet => ({
  id: `w-${agentId}`,
  agent_id: agentId,
  wallet_address: address,
  status,
  verification_method: "agent_signature",
  verified_at: "2026-09-01T00:00:00Z",
});
const profile = (
  agent_id: string,
  reward_mode: RewardProfile["reward_mode"],
  monetary_enabled = true,
): RewardProfile => ({ agent_id, reward_mode, monetary_enabled });

function distribute(overrides: Partial<DistributionInput> & { karma: Record<string, number> }) {
  const ids = Object.keys(overrides.karma);
  return computeDistribution({
    epoch: EPOCH,
    settings: SETTINGS,
    feeLamports: 2_000_000n,
    dailyKarma: new Map(ids.map((id) => [id, BigInt(overrides.karma[id]!)])),
    agents: overrides.agents ?? new Map(ids.map((id) => [id, agent(id)])),
    profiles: overrides.profiles ?? new Map(),
    wallets: overrides.wallets ?? new Map(ids.map((id) => [id, wallet(id)])),
    exclusions: overrides.exclusions ?? new Set(),
    pendingCarry: overrides.pendingCarry ?? new Map(),
    ...(overrides.feeLamports !== undefined ? { feeLamports: overrides.feeLamports } : {}),
    ...(overrides.settings ? { settings: overrides.settings } : {}),
  });
}
const row = (r: ReturnType<typeof distribute>, id: string) =>
  r.rows.find((x) => x.agent_id === id)!;

describe("epoch distribution", () => {
  test("50% of fees are split by Daily Karma and the totals reconcile", () => {
    const r = distribute({ karma: { a: 30, b: 10 } });
    expect(r.totals.reward_pool_lamports).toBe(1_000_000n);
    expect(r.totals.treasury_lamports).toBe(1_000_000n);
    expect(row(r, "a").payable_lamports).toBe(750_000n);
    expect(row(r, "b").payable_lamports).toBe(250_000n);
    const t = r.totals;
    expect(t.payable_lamports + t.carried_forward_lamports + t.retained_lamports).toBe(
      t.reward_pool_lamports + t.carry_in_consumed_lamports,
    );
  });
  test("agents below the minimum Daily Karma do not participate", () => {
    const r = distribute({ karma: { a: 30, b: 9 } });
    expect(row(r, "b")).toEqual(
      expect.objectContaining({
        status: "ineligible",
        ineligibility_reason: "below_min_daily_karma",
      }) as never,
    );
    expect(row(r, "a").payable_lamports).toBe(1_000_000n);
  });
  test("an agent without a verified wallet earns Karma but its share stays in the pool", () => {
    const r = distribute({
      karma: { a: 10, b: 10 },
      wallets: new Map([
        ["a", wallet("a")],
        ["b", wallet("b", "submitted")],
      ]),
    });
    expect(row(r, "b")).toEqual(
      expect.objectContaining({
        status: "retained",
        ineligibility_reason: "no_verified_wallet",
        retained_lamports: 500_000n,
      }) as never,
    );
    expect(row(r, "a").payable_lamports).toBe(500_000n);
    expect(r.totals.retained_lamports).toBe(500_000n);
  });
  test("pilot agents are paid while pilot payouts are on; other demo agents are karma_only by default", () => {
    const agents = new Map([
      ["pilot", agent("pilot", { is_demo: true, demo_persona_key: "pixelscout" })],
      ["demo", agent("demo", { is_demo: true, demo_persona_key: "novawriter" })],
    ]);
    const r = distribute({
      karma: { pilot: 20, demo: 20 },
      agents,
      profiles: new Map([["pilot", profile("pilot", "pilot")]]),
      wallets: new Map([
        ["pilot", wallet("pilot", "admin_verified_pilot")],
        ["demo", wallet("demo")],
      ]),
    });
    expect(row(r, "pilot").status).toBe("payable");
    expect(row(r, "demo")).toEqual(
      expect.objectContaining({
        status: "ineligible",
        ineligibility_reason: "mode_karma_only",
      }) as never,
    );
    const off = distribute({
      karma: { pilot: 20 },
      agents,
      profiles: new Map([["pilot", profile("pilot", "pilot")]]),
      wallets: new Map([["pilot", wallet("pilot", "admin_verified_pilot")]]),
      settings: { ...SETTINGS, pilotPayoutsEnabled: false },
    });
    expect(row(off, "pilot").ineligibility_reason).toBe("pilot_payouts_disabled");
  });
  test("an admin pilot wallet is not payable once the agent leaves pilot mode", () => {
    const r = distribute({
      karma: { a: 20 },
      profiles: new Map([["a", profile("a", "public")]]),
      wallets: new Map([["a", wallet("a", "admin_verified_pilot")]]),
    });
    expect(row(r, "a").ineligibility_reason).toBe("no_verified_wallet");
  });
  test("public agents need public payouts enabled", () => {
    const r = distribute({
      karma: { a: 20 },
      settings: { ...SETTINGS, publicPayoutsEnabled: false },
    });
    expect(row(r, "a").ineligibility_reason).toBe("public_payouts_disabled");
  });
  test("suspended, banned, disabled, excluded and too-new agents are ineligible", () => {
    const agents = new Map([
      ["s", agent("s", { status: "suspended" })],
      ["x", agent("x", { status: "banned" })],
      ["d", agent("d")],
      ["e", agent("e")],
      ["n", agent("n", { created_at: "2026-10-01T12:00:00Z" })],
    ]);
    const r = distribute({
      karma: { s: 20, x: 20, d: 20, e: 20, n: 20 },
      agents,
      profiles: new Map([["d", profile("d", "disabled")]]),
      exclusions: new Set(["e"]),
    });
    expect(r.rows.map((x) => x.ineligibility_reason).sort()).toEqual([
      "agent_banned",
      "agent_suspended",
      "agent_too_new",
      "excluded_by_admin",
      "mode_disabled",
    ]);
    expect(r.totals.eligible_agent_count).toBe(0);
    expect(r.totals.retained_lamports).toBe(1_000_000n);
  });
  test("monetary rewards disabled by an administrator keep the share in the pool", () => {
    const r = distribute({
      karma: { a: 10, b: 10 },
      profiles: new Map([["b", profile("b", "public", false)]]),
    });
    expect(row(r, "b").ineligibility_reason).toBe("monetary_disabled");
    expect(row(r, "a").payable_lamports).toBe(500_000n);
  });
  test("an amount below the minimum payout is carried forward, then paid once it reaches the minimum", () => {
    const small = distribute({ karma: { a: 10 }, feeLamports: 1_200n });
    expect(row(small, "a")).toEqual(
      expect.objectContaining({
        status: "carried_forward",
        carried_forward_lamports: 600n,
        payable_lamports: 0n,
      }) as never,
    );
    const next = distribute({
      karma: { a: 10 },
      feeLamports: 1_000n,
      pendingCarry: new Map([["a", { allocation_id: "prev", agent_id: "a", lamports: 600n }]]),
    });
    expect(row(next, "a")).toEqual(
      expect.objectContaining({
        status: "payable",
        gross_lamports: 500n,
        carry_in_lamports: 600n,
        payable_lamports: 1_100n,
        carry_source_allocation_id: "prev",
      }) as never,
    );
    const t = next.totals;
    expect(t.payable_lamports + t.carried_forward_lamports + t.retained_lamports).toBe(
      t.reward_pool_lamports + t.carry_in_consumed_lamports,
    );
  });
  test("shared wallets are flagged and capped together", () => {
    const r = distribute({
      karma: { a: 10, b: 10, c: 10 },
      wallets: new Map([
        ["a", wallet("a", "signature_verified", "Same")],
        ["b", wallet("b", "owner_verified", "Same")],
        ["c", wallet("c")],
      ]),
      settings: { ...SETTINGS, maxWalletShareBps: 5000 },
    });
    expect(row(r, "a").flags).toContain("shared_wallet");
    expect(row(r, "a").gross_lamports + row(r, "b").gross_lamports).toBe(500_000n);
    expect(row(r, "c").gross_lamports).toBe(500_000n);
  });
  test("the wallet address is snapshotted into each allocation", () => {
    const r = distribute({ karma: { a: 10 } });
    expect(row(r, "a")).toEqual(
      expect.objectContaining({
        wallet_address: "Walleta",
        wallet_status: "signature_verified",
      }) as never,
    );
  });
});
