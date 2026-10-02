import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS_ROW } from "../config";
import {
  approveEpoch,
  calculateEpoch,
  cancelEpoch,
  ensureEpochs,
  invalidateKarmaEvent,
  loadSettings,
  preparePilotAgents,
  refreshPool,
  runRewardsTick,
  RewardError,
} from "../service";
import {
  cancelPayoutBatch,
  createPayoutBatch,
  reconcilePayouts,
  releasePayout,
  submitPayoutSignature,
  type SignatureCrypto,
} from "../payouts";
import { buildPublicSnapshot } from "../snapshot";
import type { WalletRow } from "../ports";
import {
  LONG_COMMENT,
  LONG_POST,
  POOL,
  agent,
  makeChain,
  makeDb,
  makeDeps,
  transferTx,
  type FakeChain,
  type FakeDb,
} from "./fakes";

const sigCrypto: SignatureCrypto = {
  isValidTransactionSignature: (v): v is string =>
    typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v),
  signatureFieldIsSecretKey: async () => false,
};
const SIG = (n: number) => `${"5".repeat(60)}${String(n).replace(/0/g, "z").padStart(6, "x")}`;
const PAYER = "Payer111111111111111111111111111111111111111";

const W = {
  pixel: "PixeLWa11et111111111111111111111111111111111",
  code: "CodeWa11et1111111111111111111111111111111111",
  data: "DataWa11et1111111111111111111111111111111111",
};

function wallet(
  agentId: string,
  address: string,
  status: WalletRow["status"] = "admin_verified_pilot",
): WalletRow {
  return {
    id: `w-${agentId}-${address.slice(0, 6)}`,
    agent_id: agentId,
    wallet_address: address,
    status,
    verification_method: "admin_pilot",
    verified_at: "2026-09-01T00:00:00Z",
    is_current: true,
    revoked_at: null,
    created_at: "2026-09-01T00:00:00Z",
    created_by_type: "admin",
    last_action_reason: "private note",
  };
}

/** Three pilot agents that interact during 2026-10-01, plus other agents. */
function scenario(): { db: FakeDb; chain: FakeChain } {
  const db = makeDb({
    agents: [
      agent("pixel", { username: "pixelscout", is_demo: true, demo_persona_key: "pixelscout" }),
      agent("code", { username: "codenomad", is_demo: true, demo_persona_key: "codenomad" }),
      agent("data", { username: "datafox", is_demo: true, demo_persona_key: "datafox" }),
      agent("nova", { username: "novawriter", is_demo: true, demo_persona_key: "novawriter" }),
      agent("real", { username: "realagent" }),
    ],
    profiles: ["pixel", "code", "data"].map((id) => ({
      agent_id: id,
      reward_mode: "pilot" as const,
      monetary_enabled: true,
      admin_notes: "private note",
      updated_at: null,
    })),
    wallets: [wallet("pixel", W.pixel), wallet("code", W.code), wallet("data", W.data)],
    settings: {
      ...DEFAULT_SETTINGS_ROW,
      karma_enabled: true,
      distribution_enabled: true,
      max_agent_share_bps: 10000,
      max_wallet_share_bps: 10000,
    },
    now: new Date("2026-10-01T12:00:00Z"),
  });
  let t = Date.parse("2026-10-01T01:00:00Z");
  const at = () => new Date((t += 60_000)).toISOString();
  for (const [i, author] of ["pixel", "code", "data", "nova", "real"].entries()) {
    db.posts.push({
      id: `p-${author}`,
      agent_id: author,
      type: "Research",
      content: `${LONG_POST} #${i} by ${author}`,
      hidden: false,
      created_at: at(),
    });
  }
  const comment = (id: string, by: string, post: string) => {
    const p = db.posts.find((x) => x.id === post)!;
    db.comments.push({
      id,
      agent_id: by,
      post_id: post,
      post_agent_id: p.agent_id,
      post_hidden: false,
      content: `${LONG_COMMENT} [${id}]`,
      hidden: false,
      created_at: at(),
    });
  };
  comment("c1", "code", "p-pixel");
  comment("c2", "data", "p-pixel");
  comment("c3", "pixel", "p-code");
  comment("c4", "nova", "p-data");
  comment("c5", "real", "p-data");
  comment("c6", "data", "p-code");
  db.reactions.push({
    id: "r1",
    agent_id: "nova",
    post_id: "p-pixel",
    post_agent_id: "pixel",
    post_hidden: false,
    kind: "spark",
    created_at: at(),
  });
  const chain = makeChain();
  const addTx = (sig: string, tx: ReturnType<typeof transferTx>, finalized = true) => {
    chain.signatures.unshift({
      signature: sig,
      slot: tx.slot,
      err: tx.meta?.err ?? null,
      blockTime: tx.blockTime,
    });
    chain.transactions.set(sig, tx);
    if (finalized) chain.finalized.add(sig);
  };
  addTx(
    SIG(1),
    transferTx([{ source: PAYER, destination: POOL, lamports: 2_000_000_000 }], {
      blockTime: Date.parse("2026-10-01T09:00:00Z") / 1000,
    }),
  );
  addTx(
    SIG(2),
    transferTx([{ source: POOL, destination: PAYER, lamports: 5_000 }], {
      blockTime: Date.parse("2026-10-01T10:00:00Z") / 1000,
    }),
  );
  chain.balance = 2_000_000_000n;
  (chain as FakeChain & { addTx?: typeof addTx }).addTx = addTx;
  return { db, chain };
}
const addTx = (
  chain: FakeChain,
  sig: string,
  tx: ReturnType<typeof transferTx>,
  finalized = true,
) =>
  (
    chain as FakeChain & {
      addTx: (s: string, t: ReturnType<typeof transferTx>, f?: boolean) => void;
    }
  ).addTx(sig, tx, finalized);

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof RewardError ? error.code : String((error as Error).message);
  }
}

/** Runs the day, then moves past the end + review delay and ticks again. */
async function runDay(db: FakeDb, deps: ReturnType<typeof makeDeps>) {
  await runRewardsTick(deps, reconcilePayouts);
  db.now = new Date("2026-10-02T03:00:00Z");
  return runRewardsTick(deps, reconcilePayouts);
}
const firstEpoch = (db: FakeDb) => db.epochs.find((e) => e.epoch_key === "2026-10-01T00Z")!;

describe("global switches", () => {
  test("rewards shutdown: nothing happens while REWARDS_ENABLED is off", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain, env: { rewardsEnabled: false } });
    expect(await runRewardsTick(deps)).toEqual({ status: "disabled" });
    expect(db.epochs).toHaveLength(0);
    expect(db.events).toHaveLength(0);
    expect(chain.calls).toHaveLength(0);
  });
  test("rewards shutdown: the admin switch alone also stops accrual, and nothing recorded is deleted", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runRewardsTick(deps);
    const events = db.events.length;
    expect(events).toBeGreaterThan(0);
    db.settings = { ...db.settings!, karma_enabled: false };
    expect((await runRewardsTick(deps)).status).toBe("disabled");
    expect(db.events).toHaveLength(events);
  });
  test("distribution shutdown: epochs finalize as dry runs that can never be approved or paid", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain, env: { distributionEnabled: false } });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    expect(epoch.state).toBe("review");
    expect(epoch.run_mode).toBe("dry_run");
    const { settings } = await loadSettings(deps);
    expect(
      await code(
        approveEpoch(deps, settings, {
          epochId: epoch.id,
          calculationVersion: epoch.calculation_version,
          adminId: "a",
          reason: "r",
        }),
      ),
    ).toBe("distribution_disabled");
    expect(
      await code(
        createPayoutBatch(deps, settings, { epochId: epoch.id, adminId: "a", reason: "r" }),
      ),
    ).toBe("distribution_disabled");
    expect(db.allocations.length).toBeGreaterThan(0);
  });
});

describe("epoch lifecycle", () => {
  test("a tick creates the epoch, records Karma once, and leaves the running epoch open", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    const first = await runRewardsTick(deps);
    expect(first.epoch_key).toBe("2026-10-01T00Z");
    const count = db.events.length;
    await runRewardsTick(deps);
    await runRewardsTick(deps);
    expect(db.events).toHaveLength(count);
    expect(new Set(db.events.map((e) => e.idempotency_key)).size).toBe(count);
    expect(firstEpoch(db).state).toBe("open");
  });
  test("live calculation waits for the fee index to pass the epoch end", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runRewardsTick(deps);
    db.now = new Date("2026-10-02T03:00:00Z");
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    expect(await calculateEpoch(deps, settings, epoch.id, { type: "system", id: null })).toEqual(
      expect.objectContaining({ ok: false, code: "fee_index_incomplete" }) as never,
    );
    expect(firstEpoch(db).state).toBe("open");
    await refreshPool(deps, settings);
    const outcome = await calculateEpoch(deps, settings, epoch.id, { type: "system", id: null });
    expect(outcome).toEqual(expect.objectContaining({ ok: true, run_mode: "live" }) as never);
  });
  test("fee income counts only the inbound transfer, never the outgoing one or the balance", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    expect(db.fees).toHaveLength(1);
    expect(epoch.fee_income_lamports).toBe(2_000_000_000n);
    expect(epoch.reward_pool_lamports).toBe(1_000_000_000n);
  });
  test("an RPC failure is recorded, keeps the epoch open and never blocks Karma", async () => {
    const { db, chain } = scenario();
    chain.fail = "rpc_unreachable";
    const deps = makeDeps(db, { chain });
    const result = await runDay(db, deps);
    expect(result.pool).toBe("rpc_unreachable");
    expect(db.pool.rpc_last_error).toBe("rpc_unreachable");
    expect(firstEpoch(db).state).toBe("open");
    expect(result.calculated).toEqual([
      { epoch_key: "2026-10-01T00Z", outcome: "fee_index_incomplete" },
    ]);
    expect(db.events.length).toBeGreaterThan(0);
  });
  test("recalculating is idempotent: same table, new version, no duplicates", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    const before = db.allocations
      .filter((a) => a.epoch_id === epoch.id)
      .map((a) => [a.agent_id, a.status, a.payable_lamports]);
    const { settings } = await loadSettings(deps);
    const again = await calculateEpoch(deps, settings, epoch.id, {
      type: "admin",
      id: "admin",
      reason: "recheck",
    });
    expect(again).toEqual(expect.objectContaining({ ok: true, calculation_version: 2 }) as never);
    const after = db.allocations
      .filter((a) => a.epoch_id === epoch.id)
      .map((a) => [a.agent_id, a.status, a.payable_lamports]);
    expect(after).toEqual(before);
  });
  test("invalid transitions are refused", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runRewardsTick(deps);
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    expect(
      await code(
        approveEpoch(deps, settings, {
          epochId: epoch.id,
          calculationVersion: 1,
          adminId: "a",
          reason: "r",
        }),
      ),
    ).toBe("invalid_state");
    expect(await calculateEpoch(deps, settings, epoch.id, { type: "admin", id: "a" })).toEqual(
      expect.objectContaining({ ok: false, code: "epoch_not_ended" }) as never,
    );
    expect(
      await code(
        createPayoutBatch(deps, settings, { epochId: epoch.id, adminId: "a", reason: "r" }),
      ),
    ).toBe("invalid_state");
    await cancelEpoch(deps, { epochId: epoch.id, adminId: "a", reason: "test" });
    expect(
      await code(cancelEpoch(deps, { epochId: epoch.id, adminId: "a", reason: "again" })),
    ).toBe("invalid_state");
  });
  test("a stale calculation cannot be approved", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    expect(
      await code(
        approveEpoch(deps, settings, {
          epochId: epoch.id,
          calculationVersion: epoch.calculation_version + 1,
          adminId: "a",
          reason: "r",
        }),
      ),
    ).toBe("stale_calculation");
  });
  test("a wallet change after the calculation blocks approval until recalculated", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    await deps.store.replaceWallet({
      agentId: "pixel",
      address: "NewPixe1Wa11et11111111111111111111111111111",
      status: "admin_verified_pilot",
      method: "admin_pilot",
      actorType: "admin",
      actorId: "a",
      reason: "rotate",
    });
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    expect(
      await code(
        approveEpoch(deps, settings, {
          epochId: epoch.id,
          calculationVersion: epoch.calculation_version,
          adminId: "a",
          reason: "r",
        }),
      ),
    ).toBe("wallets_changed");
  });
  test("Karma of an approved epoch can no longer be invalidated", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    await approveEpoch(deps, settings, {
      epochId: epoch.id,
      calculationVersion: epoch.calculation_version,
      adminId: "a",
      reason: "ok",
    });
    const event = db.events.find((e) => e.epoch_id === epoch.id && e.status === "valid")!;
    expect(
      await code(invalidateKarmaEvent(deps, { eventId: event.id, adminId: "a", reason: "late" })),
    ).toBe("epoch_finalized");
  });
});

describe("pilot distribution and payouts", () => {
  async function approved() {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runDay(db, deps);
    const epoch = firstEpoch(db);
    const { settings } = await loadSettings(deps);
    await approveEpoch(deps, settings, {
      epochId: epoch.id,
      calculationVersion: epoch.calculation_version,
      adminId: "admin",
      reason: "reviewed",
    });
    return { db, chain, deps, settings, epoch: firstEpoch(db) };
  }

  test("only the three pilot agents are payable; other demo agents stay karma_only", async () => {
    const { db, epoch } = await approved();
    const rows = db.allocations.filter((a) => a.epoch_id === epoch.id);
    const payable = rows
      .filter((a) => a.status === "payable")
      .map((a) => a.agent_id)
      .sort();
    expect(payable).toEqual(["code", "data", "pixel"]);
    expect(rows.find((a) => a.agent_id === "nova")?.ineligibility_reason ?? "no_karma_row").toMatch(
      /mode_karma_only|below_min_daily_karma|no_karma_row/,
    );
    expect(rows.find((a) => a.agent_id === "real")?.ineligibility_reason).toBe(
      "public_payouts_disabled",
    );
    const total = rows.reduce((s, a) => s + a.payable_lamports, 0n);
    expect(total <= epoch.reward_pool_lamports).toBe(true);
  });

  test("a payout is recorded only for the exact on-chain transfer and paid only at finalized commitment", async () => {
    const { db, chain, deps, settings, epoch } = await approved();
    const { batchId } = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "pay",
    });
    const payouts = db.payouts.filter((p) => p.batch_id === batchId);
    expect(payouts).toHaveLength(3);
    expect(firstEpoch(db).state).toBe("paying");
    const pixel = payouts.find((p) => p.agent_id === "pixel")!;
    const blockTime = Date.parse("2026-10-02T03:05:00Z") / 1000;
    // Wrong amount: refused, nothing stored.
    addTx(
      chain,
      SIG(10),
      transferTx([{ source: POOL, destination: W.pixel, lamports: Number(pixel.lamports) + 1 }], {
        blockTime,
      }),
    );
    expect(
      await code(
        submitPayoutSignature(deps, settings, sigCrypto, {
          payoutIds: [pixel.id],
          signature: SIG(10),
          adminId: "admin",
          reason: "sent",
        }),
      ),
    ).toBe("transfer_not_found");
    expect(db.payouts.find((p) => p.id === pixel.id)!.tx_signature).toBeNull();
    // Unknown signature: refused, nothing stored.
    expect(
      await code(
        submitPayoutSignature(deps, settings, sigCrypto, {
          payoutIds: [pixel.id],
          signature: SIG(99),
          adminId: "admin",
          reason: "sent",
        }),
      ),
    ).toBe("tx_not_found");
    // Correct transfer, confirmed but not yet finalized.
    addTx(
      chain,
      SIG(11),
      transferTx([{ source: POOL, destination: W.pixel, lamports: Number(pixel.lamports) }], {
        blockTime,
      }),
      false,
    );
    const r = await submitPayoutSignature(deps, settings, sigCrypto, {
      payoutIds: [pixel.id],
      signature: SIG(11),
      adminId: "admin",
      reason: "sent",
    });
    expect(r.results).toEqual([{ payout_id: pixel.id, status: "submitted" }]);
    expect(db.payouts.find((p) => p.id === pixel.id)!.status).toBe("submitted");
    expect(db.allocations.find((a) => a.id === pixel.allocation_id)!.status).toBe("payable");
    // Finalized: the next reconciliation confirms it.
    chain.finalized.add(SIG(11));
    expect(await reconcilePayouts(deps, settings)).toBe(1);
    expect(db.payouts.find((p) => p.id === pixel.id)!.status).toBe("confirmed");
    expect(db.allocations.find((a) => a.id === pixel.allocation_id)!.status).toBe("paid");
  });

  test("one transaction paying several agents settles each payout with its own transfer; reuse is impossible", async () => {
    const { db, chain, deps, settings, epoch } = await approved();
    const { batchId } = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "pay",
    });
    const payouts = db.payouts.filter((p) => p.batch_id === batchId);
    const blockTime = Date.parse("2026-10-02T03:05:00Z") / 1000;
    addTx(
      chain,
      SIG(20),
      transferTx(
        payouts.map((p) => ({
          source: POOL,
          destination: p.recipient_address,
          lamports: Number(p.lamports),
        })),
        { blockTime },
      ),
    );
    await submitPayoutSignature(deps, settings, sigCrypto, {
      payoutIds: payouts.map((p) => p.id),
      signature: SIG(20),
      adminId: "admin",
      reason: "batch",
    });
    expect(new Set(db.payouts.map((p) => p.transfer_index)).size).toBe(3);
    expect(firstEpoch(db).state).toBe("paid");
    // Paid allocations can never be paid again.
    expect(
      await code(
        createPayoutBatch(deps, settings, { epochId: epoch.id, adminId: "admin", reason: "again" }),
      ),
    ).toBe("invalid_state");
  });

  test("replacing a wallet after approval changes nothing already finalized and never pays twice", async () => {
    const { db, chain, deps, settings, epoch } = await approved();
    await deps.store.replaceWallet({
      agentId: "pixel",
      address: "NewPixe1Wa11et11111111111111111111111111111",
      status: "admin_verified_pilot",
      method: "admin_pilot",
      actorType: "admin",
      actorId: "admin",
      reason: "rotate",
    });
    const allocation = db.allocations.find(
      (a) => a.epoch_id === epoch.id && a.agent_id === "pixel",
    )!;
    expect(allocation.wallet_address).toBe(W.pixel);
    const { batchId } = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "pay",
    });
    const payout = db.payouts.find((p) => p.batch_id === batchId && p.agent_id === "pixel")!;
    expect(payout.recipient_address).toBe(W.pixel);
    // A transfer to the NEW wallet does not settle the payout snapshotted to the old one.
    addTx(
      chain,
      SIG(30),
      transferTx(
        [
          {
            source: POOL,
            destination: "NewPixe1Wa11et11111111111111111111111111111",
            lamports: Number(payout.lamports),
          },
        ],
        { blockTime: Date.parse("2026-10-02T03:05:00Z") / 1000 },
      ),
    );
    expect(
      await code(
        submitPayoutSignature(deps, settings, sigCrypto, {
          payoutIds: [payout.id],
          signature: SIG(30),
          adminId: "admin",
          reason: "x",
        }),
      ),
    ).toBe("transfer_not_found");
    // A second batch for the same allocations is refused while the first is open.
    expect(
      await code(
        createPayoutBatch(deps, settings, { epochId: epoch.id, adminId: "admin", reason: "again" }),
      ),
    ).toBe("invalid_state");
    // Finalized allocations cannot be rewritten by a recalculation either.
    expect(await code(deps.store.saveAllocations(epoch.id, [], 99))).toBe("ok");
    expect(db.allocations.find((a) => a.id === allocation.id)!.status).toBe("payable");
  });

  test("a submitted payout can be released only when its transaction does not exist", async () => {
    const { db, chain, deps, settings, epoch } = await approved();
    const { batchId } = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "pay",
    });
    const payout = db.payouts.find((p) => p.batch_id === batchId)!;
    addTx(
      chain,
      SIG(40),
      transferTx(
        [
          {
            source: POOL,
            destination: payout.recipient_address,
            lamports: Number(payout.lamports),
          },
        ],
        { blockTime: Date.parse("2026-10-02T03:05:00Z") / 1000 },
      ),
      false,
    );
    await submitPayoutSignature(deps, settings, sigCrypto, {
      payoutIds: [payout.id],
      signature: SIG(40),
      adminId: "admin",
      reason: "sent",
    });
    db.now = new Date(db.now.getTime() + 11 * 60_000);
    expect(
      await code(releasePayout(deps, { payoutId: payout.id, adminId: "admin", reason: "retry" })),
    ).toBe("tx_exists");
    chain.transactions.delete(SIG(40));
    await releasePayout(deps, { payoutId: payout.id, adminId: "admin", reason: "dropped" });
    expect(db.payouts.find((p) => p.id === payout.id)!.status).toBe("pending");
  });

  test("an open batch without submissions can be cancelled; the epoch returns to approved", async () => {
    const { db, deps, settings, epoch } = await approved();
    const { batchId } = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "pay",
    });
    await cancelPayoutBatch(deps, { batchId, adminId: "admin", reason: "wrong day" });
    expect(firstEpoch(db).state).toBe("approved");
    expect(db.payouts.every((p) => p.status === "cancelled")).toBe(true);
    const again = await createPayoutBatch(deps, settings, {
      epochId: epoch.id,
      adminId: "admin",
      reason: "retry",
    });
    expect(db.payouts.filter((p) => p.batch_id === again.batchId)).toHaveLength(3);
  });

  test("turning distribution off after approval blocks payouts but keeps the allocations", async () => {
    const { db, deps, epoch } = await approved();
    db.settings = { ...db.settings!, distribution_enabled: false };
    const { settings } = await loadSettings(deps);
    expect(
      await code(
        createPayoutBatch(deps, settings, { epochId: epoch.id, adminId: "admin", reason: "pay" }),
      ),
    ).toBe("distribution_disabled");
    expect(
      db.allocations.filter((a) => a.epoch_id === epoch.id && a.finalized_at).length,
    ).toBeGreaterThan(0);
  });
});

describe("pilot preparation", () => {
  test("resolves the three pilots by persona key, pins other demo agents to karma_only, and is idempotent", async () => {
    const db = makeDb({
      agents: [
        agent("u1", { username: "pixelscout", is_demo: true, demo_persona_key: "pixelscout" }),
        agent("u2", { username: "codenomad", is_demo: true, demo_persona_key: "codenomad" }),
        agent("u3", { username: "datafox", is_demo: true, demo_persona_key: "datafox" }),
        agent("u4", { username: "novawriter", is_demo: true, demo_persona_key: "novawriter" }),
        agent("u5", { username: "flowforge", is_demo: true, demo_persona_key: "flowforge" }),
        agent("u6", { username: "realagent" }),
      ],
      profiles: [
        {
          agent_id: "u5",
          reward_mode: "public",
          monetary_enabled: true,
          admin_notes: null,
          updated_at: null,
        },
      ],
    });
    const deps = makeDeps(db);
    const dry = await preparePilotAgents(deps, { adminId: "admin", reason: "pilot", dryRun: true });
    expect(dry.missing).toEqual([]);
    expect(db.profiles).toHaveLength(1);
    await preparePilotAgents(deps, { adminId: "admin", reason: "pilot", dryRun: false });
    const mode = (id: string) => db.profiles.find((p) => p.agent_id === id)?.reward_mode;
    expect([mode("u1"), mode("u2"), mode("u3")]).toEqual(["pilot", "pilot", "pilot"]);
    expect([mode("u4"), mode("u5")]).toEqual(["karma_only", "karma_only"]);
    expect(mode("u6")).toBeUndefined();
    expect(db.audit.some((e) => e.action === "pilot.prepared")).toBe(true);
    const second = await preparePilotAgents(deps, {
      adminId: "admin",
      reason: "again",
      dryRun: false,
    });
    expect(second.plan).toEqual([]);
  });
  test("a real agent that took a pilot username is never promoted", async () => {
    const db = makeDb({ agents: [agent("r", { username: "datafox" })] });
    const result = await preparePilotAgents(makeDeps(db), {
      adminId: "a",
      reason: "p",
      dryRun: false,
    });
    expect(result.missing).toEqual(["pixelscout", "codenomad", "datafox"]);
    expect(db.profiles).toHaveLength(0);
  });
});

describe("public snapshot", () => {
  test("contains estimates and pilot labels but no private data", async () => {
    const { db, chain } = scenario();
    const deps = makeDeps(db, { chain });
    await runRewardsTick(deps);
    const { settings } = await loadSettings(deps);
    await refreshPool(deps, settings);
    const snapshot = await buildPublicSnapshot(deps, settings);
    expect(snapshot.pool.address).toBe(POOL);
    expect(snapshot.pool.balance_sol).toBe("2");
    expect(snapshot.current_epoch?.fees_received_sol).toBe("2");
    expect(snapshot.current_epoch?.agent_rewards_sol).toBe("1");
    const pixel = snapshot.leaderboard.find((e) => e.username === "pixelscout")!;
    expect(pixel.is_pilot).toBe(true);
    expect(pixel.pilot_wallet_note).toBe(
      "Pilot payout wallet configured by platform administrator",
    );
    const json = JSON.stringify(snapshot);
    for (const secret of [
      "private note",
      "admin_notes",
      "flags",
      "last_action_reason",
      "nonce",
      "verification_method",
      W.pixel,
    ])
      expect(json).not.toContain(secret);
  });
  test("ensureEpochs restarts after a long pause instead of back-filling disabled days", async () => {
    const db = makeDb();
    const deps = makeDeps(db);
    const { settings } = await loadSettings(deps);
    await ensureEpochs(deps, settings);
    db.now = new Date("2026-10-20T12:00:00Z");
    const current = await ensureEpochs(deps, settings);
    expect(current.epoch_key).toBe("2026-10-20T00Z");
    expect(db.epochs).toHaveLength(2);
  });
});
