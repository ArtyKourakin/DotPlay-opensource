import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EPOCH_STATES,
  EPOCH_TRANSITIONS,
  canTransition,
  epochWindowContaining,
  isDueForCalculation,
  missingEpochWindows,
  nextEpochWindow,
} from "../epochs";
import {
  extractSolTransfers,
  feeTransfersOf,
  findPayoutTransfer,
  indexPoolTransactions,
  type FeeTransferRow,
} from "../fees";
import { createFetchRpc, rpcErrorCode } from "../rpc.server";
import { POOL, makeChain, makeRpc, transferTx } from "./fakes";

const PAYER = "Payer111111111111111111111111111111111111111";
const OTHER = "Other111111111111111111111111111111111111111";
const AGENT = "Agent111111111111111111111111111111111111111";

describe("fee transfers", () => {
  test("only inbound transfers to the pool wallet are fee income", () => {
    const tx = transferTx([
      { source: PAYER, destination: POOL, lamports: 5_000 },
      { source: POOL, destination: AGENT, lamports: 2_000 }, // outgoing reward payment
      { source: PAYER, destination: OTHER, lamports: 9_999 }, // unrelated
      { source: POOL, destination: POOL, lamports: 1 }, // self-transfer
    ]);
    const rows = feeTransfersOf("sig1", tx, POOL, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        transfer_index: "0",
        lamports: 5_000n,
        status: "eligible",
        source_address: PAYER,
      }) as never,
    );
  });
  test("inner (CPI) transfers are found and keyed by position", () => {
    const tx = transferTx([], {
      inner: [
        {
          index: 2,
          transfers: [
            { source: PAYER, destination: POOL, lamports: 700 },
            { source: OTHER, destination: POOL, lamports: 300 },
          ],
        },
      ],
    });
    expect(feeTransfersOf("sig", tx, POOL, []).map((r) => r.transfer_index)).toEqual([
      "2.0",
      "2.1",
    ]);
  });
  test("failed transactions and transactions without a block time count for nothing", () => {
    expect(
      feeTransfersOf(
        "s",
        transferTx([{ source: PAYER, destination: POOL, lamports: 5 }], {
          err: { InstructionError: [0, "Custom"] },
        }),
        POOL,
        [],
      ),
    ).toEqual([]);
    expect(
      feeTransfersOf(
        "s",
        transferTx([{ source: PAYER, destination: POOL, lamports: 5 }], { blockTime: null }),
        POOL,
        [],
      ),
    ).toEqual([]);
  });
  test("with an allowlist, other sources are recorded but ignored", () => {
    const tx = transferTx([
      { source: PAYER, destination: POOL, lamports: 5 },
      { source: OTHER, destination: POOL, lamports: 7 },
    ]);
    const rows = feeTransfersOf("s", tx, POOL, [PAYER]);
    expect(rows.map((r) => r.status)).toEqual(["eligible", "ignored_not_allowlisted"]);
  });
  test("non-system and malformed instructions are ignored", () => {
    const tx = transferTx([]);
    tx.transaction.message.instructions.push(
      {
        program: "spl-token",
        parsed: { type: "transfer", info: { source: PAYER, destination: POOL, amount: "5" } },
      },
      {
        program: "system",
        parsed: { type: "transfer", info: { source: PAYER, destination: POOL, lamports: -5 } },
      },
      { program: "system", parsed: "raw" },
    );
    expect(extractSolTransfers(tx)).toEqual([]);
  });
});

function chainWith(count: number) {
  const chain = makeChain();
  for (let i = 0; i < count; i++) {
    const sig = `sig${String(i).padStart(4, "0")}`;
    const blockTime = Date.parse("2026-10-01T00:00:00Z") / 1000 + i * 60;
    chain.signatures.unshift({ signature: sig, slot: i, err: null, blockTime });
    chain.transactions.set(
      sig,
      transferTx([{ source: PAYER, destination: POOL, lamports: 1_000 + i }], {
        blockTime,
        slot: i,
      }),
    );
    chain.finalized.add(sig);
  }
  return chain;
}

function memoryIndexStore() {
  const rows: FeeTransferRow[] = [];
  return {
    rows,
    async insertFeeTransfers(batch: FeeTransferRow[]) {
      for (const r of batch)
        if (!rows.some((x) => x.signature === r.signature && x.transfer_index === r.transfer_index))
          rows.push(r);
    },
  };
}

describe("fee indexer", () => {
  const notBeforeMs = Date.parse("2026-09-30T00:00:00Z");
  test("indexes every finalized inbound transfer once, oldest first, and advances the cursor", async () => {
    const chain = chainWith(12);
    const store = memoryIndexStore();
    const r = await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: null,
      notBeforeMs,
      pageSize: 5,
    });
    expect(r.complete).toBe(true);
    expect(store.rows).toHaveLength(12);
    expect(r.newCursor).toBe("sig0011");
    // Replaying from scratch never duplicates a transfer.
    await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: null,
      notBeforeMs,
      pageSize: 5,
    });
    expect(store.rows).toHaveLength(12);
    // With the cursor, only newer signatures are fetched.
    const more = await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: r.newCursor,
      notBeforeMs,
    });
    expect(more.processed).toBe(0);
  });
  test("unfinalized transactions are not indexed yet", async () => {
    const chain = chainWith(3);
    chain.finalized.delete("sig0002");
    const store = memoryIndexStore();
    const r = await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: null,
      notBeforeMs,
    });
    expect(store.rows.map((x) => x.signature)).toEqual(["sig0000", "sig0001"]);
    expect(r.newCursor).toBe("sig0001");
  });
  test("failed transactions advance the cursor without recording income", async () => {
    const chain = chainWith(2);
    chain.signatures[0]!.err = { InstructionError: [0, "x"] };
    const store = memoryIndexStore();
    const r = await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: null,
      notBeforeMs,
    });
    expect(store.rows).toHaveLength(1);
    expect(r.newCursor).toBe("sig0001");
  });
  test("a backlog larger than one run is not processed and the cursor never skips", async () => {
    const chain = chainWith(30);
    const store = memoryIndexStore();
    const r = await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: "sig0000",
      notBeforeMs,
      pageSize: 5,
      maxPages: 2,
    });
    expect(r.backlog).toBe(true);
    expect(r.newCursor).toBe("sig0000");
    expect(store.rows).toHaveLength(0);
  });
  test("history older than the first epoch is skipped", async () => {
    const chain = chainWith(4);
    const store = memoryIndexStore();
    await indexPoolTransactions({
      rpc: makeRpc(chain),
      store,
      poolWallet: POOL,
      allowlist: [],
      cursor: null,
      notBeforeMs: Date.parse("2026-10-01T00:02:00Z"),
    });
    expect(store.rows.map((x) => x.signature)).toEqual(["sig0002", "sig0003"]);
  });
  test("an RPC failure propagates and records nothing", async () => {
    const chain = chainWith(2);
    chain.fail = "rpc_unreachable";
    const store = memoryIndexStore();
    let failed = false;
    try {
      await indexPoolTransactions({
        rpc: makeRpc(chain),
        store,
        poolWallet: POOL,
        allowlist: [],
        cursor: null,
        notBeforeMs,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(store.rows).toHaveLength(0);
  });
});

describe("payout verification", () => {
  const tx = transferTx([
    { source: POOL, destination: AGENT, lamports: 1_500_000 },
    { source: POOL, destination: OTHER, lamports: 1_500_000 },
  ]);
  const base = {
    tx,
    finalized: true,
    poolWallet: POOL,
    recipient: AGENT,
    lamports: 1_500_000n,
    notBefore: "2026-10-01T09:00:00Z",
    usedTransferIndexes: new Set<string>(),
  };
  test("the exact transfer from the pool to the recipient is accepted", () => {
    expect(findPayoutTransfer(base)).toEqual(
      expect.objectContaining({ ok: true, transfer_index: "0" }) as never,
    );
  });
  test("a wrong amount, recipient or source is refused", () => {
    expect(findPayoutTransfer({ ...base, lamports: 1_500_001n })).toEqual({
      ok: false,
      code: "transfer_not_found",
    });
    expect(findPayoutTransfer({ ...base, recipient: PAYER })).toEqual({
      ok: false,
      code: "transfer_not_found",
    });
    expect(findPayoutTransfer({ ...base, poolWallet: PAYER })).toEqual({
      ok: false,
      code: "transfer_not_found",
    });
  });
  test("an unfinalized, failed, missing or older transaction is refused", () => {
    expect(findPayoutTransfer({ ...base, finalized: false })).toEqual({
      ok: false,
      code: "tx_not_finalized",
    });
    expect(findPayoutTransfer({ ...base, tx: null })).toEqual({ ok: false, code: "tx_not_found" });
    expect(
      findPayoutTransfer({
        ...base,
        tx: transferTx([{ source: POOL, destination: AGENT, lamports: 1_500_000 }], { err: "x" }),
      }),
    ).toEqual({ ok: false, code: "tx_failed" });
    expect(findPayoutTransfer({ ...base, notBefore: "2026-10-02T00:00:00Z" })).toEqual({
      ok: false,
      code: "tx_too_old",
    });
  });
  test("a transfer already used by another payout cannot settle a second one", () => {
    expect(findPayoutTransfer({ ...base, usedTransferIndexes: new Set(["0"]) })).toEqual({
      ok: false,
      code: "transfer_not_found",
    });
  });
});

describe("RPC client", () => {
  type RpcBody = { method: string; params: unknown[] };
  const fakeFetch = (handler: (body: RpcBody) => Response | Promise<Response>) =>
    (async (_url: unknown, init?: RequestInit) =>
      handler(JSON.parse(String(init?.body)) as RpcBody)) as unknown as typeof fetch;
  test("reads the finalized balance as bigint lamports", async () => {
    let seen: RpcBody | undefined;
    const rpc = createFetchRpc(
      "https://rpc.example/secret-key",
      fakeFetch(
        (body) => (
          (seen = body),
          Response.json({ result: { context: { slot: 9 }, value: 12345 } })
        ),
      ),
    );
    expect(await rpc.getBalance(POOL)).toEqual({ lamports: 12345n, slot: 9 });
    expect(seen?.params[1]).toEqual({ commitment: "finalized" });
  });
  test("failures become short codes that never contain the endpoint", async () => {
    const cases: [typeof fetch, string][] = [
      [fakeFetch(() => new Response("nope", { status: 429 })), "rpc_http_429"],
      [
        fakeFetch(() => Response.json({ error: { code: -32005, message: "secret-key limit" } })),
        "rpc_error_-32005",
      ],
      [fakeFetch(() => new Response("not json")), "rpc_bad_response"],
      [
        (async () => {
          throw new Error("connect ECONNREFUSED https://rpc.example/secret-key");
        }) as unknown as typeof fetch,
        "rpc_unreachable",
      ],
    ];
    for (const [impl, code] of cases) {
      const rpc = createFetchRpc("https://rpc.example/secret-key", impl);
      let caught: unknown;
      try {
        await rpc.getBalance(POOL);
      } catch (error) {
        caught = error;
      }
      expect(rpcErrorCode(caught)).toBe(code);
      expect(String((caught as Error).message)).not.toContain("secret-key");
    }
  });
  test("transactions are requested jsonParsed with the requested commitment", async () => {
    let seen: RpcBody | undefined;
    const rpc = createFetchRpc(
      "https://rpc.example",
      fakeFetch((body) => ((seen = body), Response.json({ result: null }))),
    );
    expect(await rpc.getTransaction("sig", "finalized")).toBeNull();
    expect(seen?.params[1]).toEqual({
      commitment: "finalized",
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
    });
  });
});

describe("epoch lifecycle", () => {
  test("daily windows start at the configured UTC hour", () => {
    const w = epochWindowContaining(Date.parse("2026-10-01T05:30:00Z"), 6);
    expect(w).toEqual({
      epoch_key: "2026-09-30T06Z",
      starts_at: "2026-09-30T06:00:00.000Z",
      ends_at: "2026-10-01T06:00:00.000Z",
    });
    expect(epochWindowContaining(Date.parse("2026-10-01T00:00:00Z"), 0).starts_at).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });
  test("epochs are contiguous, even when the hour changes", () => {
    const next = nextEpochWindow("2026-10-02T00:00:00.000Z", 12);
    expect(next.starts_at).toBe("2026-10-02T00:00:00.000Z");
    expect(next.ends_at).toBe("2026-10-02T12:00:00.000Z");
    const catchUp = missingEpochWindows(
      "2026-10-01T00:00:00.000Z",
      Date.parse("2026-10-03T01:00:00Z"),
      0,
    );
    expect(catchUp.map((w) => w.epoch_key)).toEqual([
      "2026-10-01T00Z",
      "2026-10-02T00Z",
      "2026-10-03T00Z",
    ]);
  });
  test("an epoch is calculated only after its review delay", () => {
    expect(isDueForCalculation("2026-10-02T00:00:00Z", 2, Date.parse("2026-10-02T01:59:00Z"))).toBe(
      false,
    );
    expect(isDueForCalculation("2026-10-02T00:00:00Z", 2, Date.parse("2026-10-02T02:00:00Z"))).toBe(
      true,
    );
  });
  test("only the documented transitions are valid", () => {
    expect(canTransition("open", "calculating")).toBe(true);
    expect(canTransition("review", "approved")).toBe(true);
    expect(canTransition("open", "approved")).toBe(false);
    expect(canTransition("paid", "open")).toBe(false);
    expect(canTransition("cancelled", "review")).toBe(false);
    expect(canTransition("approved", "review")).toBe(false);
  });
  test.skip("the database trigger enforces exactly the same transition table", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260926120000_karma_rewards.sql"),
      "utf8",
    );
    const guard = sql.slice(
      sql.indexOf("reward_epochs_transition_guard()"),
      sql.indexOf("RAISE EXCEPTION 'invalid reward epoch transition"),
    );
    for (const from of EPOCH_STATES) {
      const targets = EPOCH_TRANSITIONS[from];
      if (targets.length === 0) {
        expect(guard.includes(`OLD.state = '${from}'`)).toBe(false);
        continue;
      }
      const line = guard.split("\n").find((l) => l.includes(`OLD.state = '${from}'`)) ?? "";
      const listed = [...line.matchAll(/'([a-z_]+)'/g)]
        .map((m) => m[1])
        .slice(1)
        .sort();
      expect({ from, listed }).toEqual({ from, listed: [...targets].sort() });
    }
  });
});
