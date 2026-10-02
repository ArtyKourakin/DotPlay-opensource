// Reward Pool fee indexing and payout verification over Solana transactions.
// Pure module: the RPC is an injected port, so tests never touch the network.
//
// Fee income is never inferred from the wallet balance: outgoing reward
// payments change the balance too. Instead every finalized, successful
// transaction that touches the pool wallet is inspected, and each System
// Program transfer INTO the pool wallet from another address is recorded once,
// keyed by (signature, instruction position).

export type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
  confirmationStatus?: string | null;
};

type ParsedInstruction = {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
};

export type ParsedTransaction = {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[] | null;
  } | null;
  transaction: {
    signatures?: string[];
    message: { instructions: ParsedInstruction[] };
  };
};

/** The operations the reward system needs from a Solana JSON-RPC endpoint. */
export interface SolanaRpc {
  getHealth(): Promise<"ok">;
  getBalance(address: string): Promise<{ lamports: bigint; slot: number }>;
  getSignaturesForAddress(
    address: string,
    options: { before?: string; until?: string; limit: number },
  ): Promise<SignatureInfo[]>;
  /** Returns null when the transaction is unknown at the requested commitment. */
  getTransaction(
    signature: string,
    commitment: "finalized" | "confirmed",
  ): Promise<ParsedTransaction | null>;
}

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

export type SolTransfer = {
  transfer_index: string;
  source: string;
  destination: string;
  lamports: bigint;
};

function asTransfer(ix: ParsedInstruction, index: string): SolTransfer | null {
  const isSystem = ix.program === "system" || ix.programId === SYSTEM_PROGRAM_ID;
  if (!isSystem || !ix.parsed || typeof ix.parsed === "string") return null;
  const type = ix.parsed.type;
  if (type !== "transfer" && type !== "transferWithSeed") return null;
  const info = ix.parsed.info ?? {};
  const source = typeof info["source"] === "string" ? info["source"] : null;
  const destination = typeof info["destination"] === "string" ? info["destination"] : null;
  const raw = info["lamports"];
  const lamports =
    typeof raw === "number" && Number.isSafeInteger(raw)
      ? BigInt(raw)
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? BigInt(raw)
        : null;
  if (!source || !destination || lamports === null || lamports <= 0n) return null;
  return { transfer_index: index, source, destination, lamports };
}

/** Every native SOL transfer of a transaction, top-level ("3") and inner ("3.1"). */
export function extractSolTransfers(tx: ParsedTransaction): SolTransfer[] {
  const out: SolTransfer[] = [];
  tx.transaction.message.instructions.forEach((ix, i) => {
    const t = asTransfer(ix, String(i));
    if (t) out.push(t);
  });
  for (const group of tx.meta?.innerInstructions ?? []) {
    group.instructions.forEach((ix, j) => {
      const t = asTransfer(ix, `${group.index}.${j}`);
      if (t) out.push(t);
    });
  }
  return out;
}

export type FeeTransferRow = {
  signature: string;
  transfer_index: string;
  slot: number;
  block_time: string;
  source_address: string;
  destination_address: string;
  lamports: bigint;
  status: "eligible" | "ignored_not_allowlisted";
};

/**
 * Inbound fee transfers of one transaction. Failed transactions, transactions
 * without a block time, outgoing transfers and self-transfers produce nothing.
 * With an allowlist, a transfer from any other source is kept for review but
 * marked ignored, so it never counts as income.
 */
export function feeTransfersOf(
  signature: string,
  tx: ParsedTransaction,
  poolWallet: string,
  allowlist: readonly string[],
): FeeTransferRow[] {
  if (!tx.meta || (tx.meta.err !== null && tx.meta.err !== undefined)) return [];
  if (tx.blockTime === null || tx.blockTime === undefined) return [];
  const allow = new Set(allowlist);
  return extractSolTransfers(tx)
    .filter((t) => t.destination === poolWallet && t.source !== poolWallet)
    .map((t) => ({
      signature,
      transfer_index: t.transfer_index,
      slot: tx.slot,
      block_time: new Date(tx.blockTime! * 1000).toISOString(),
      source_address: t.source,
      destination_address: t.destination,
      lamports: t.lamports,
      status:
        allow.size === 0 || allow.has(t.source)
          ? ("eligible" as const)
          : ("ignored_not_allowlisted" as const),
    }));
}

export type PayoutCheck =
  | { ok: true; transfer_index: string; slot: number; block_time: string }
  | {
      ok: false;
      code: "tx_not_found" | "tx_not_finalized" | "tx_failed" | "transfer_not_found" | "tx_too_old";
    };

/**
 * Confirms that a finalized, successful transaction contains a System transfer
 * of exactly `lamports` from the pool wallet to `recipient`, not already used
 * by another payout, and executed after the batch was created.
 */
export function findPayoutTransfer(input: {
  tx: ParsedTransaction | null;
  finalized: boolean;
  poolWallet: string;
  recipient: string;
  lamports: bigint;
  notBefore: string;
  usedTransferIndexes: ReadonlySet<string>;
}): PayoutCheck {
  const { tx } = input;
  if (!tx) return { ok: false, code: "tx_not_found" };
  if (tx.meta && tx.meta.err !== null && tx.meta.err !== undefined)
    return { ok: false, code: "tx_failed" };
  if (!input.finalized) return { ok: false, code: "tx_not_finalized" };
  if (tx.blockTime === null || tx.blockTime === undefined)
    return { ok: false, code: "tx_not_finalized" };
  const blockTime = new Date(tx.blockTime * 1000).toISOString();
  // Allow one minute of clock skew between the database and the validators.
  if (Date.parse(blockTime) < Date.parse(input.notBefore) - 60_000)
    return { ok: false, code: "tx_too_old" };
  const match = extractSolTransfers(tx).find(
    (t) =>
      t.source === input.poolWallet &&
      t.destination === input.recipient &&
      t.lamports === input.lamports &&
      !input.usedTransferIndexes.has(t.transfer_index),
  );
  if (!match) return { ok: false, code: "transfer_not_found" };
  return { ok: true, transfer_index: match.transfer_index, slot: tx.slot, block_time: blockTime };
}

export type IndexerStore = {
  insertFeeTransfers(rows: FeeTransferRow[]): Promise<void>;
};

export type IndexResult = {
  scanned: number;
  processed: number;
  recorded: number;
  newCursor: string | null;
  complete: boolean;
  backlog: boolean;
};

/**
 * Indexes new pool-wallet transactions after `cursor` (the newest signature
 * already processed). Signatures are fetched newest-first page by page, then
 * processed oldest-first, so the cursor only ever advances over transactions
 * that were fully recorded. Replays are harmless: rows are unique by
 * (signature, transfer_index).
 */
export async function indexPoolTransactions(input: {
  rpc: SolanaRpc;
  store: IndexerStore;
  poolWallet: string;
  allowlist: readonly string[];
  cursor: string | null;
  /** Transactions older than this are not needed (before the first epoch). */
  notBeforeMs: number;
  pageSize?: number;
  maxPages?: number;
  maxTransactions?: number;
}): Promise<IndexResult> {
  const pageSize = input.pageSize ?? 500;
  const maxPages = input.maxPages ?? 10;
  const maxTransactions = input.maxTransactions ?? 150;

  const collected: SignatureInfo[] = [];
  let before: string | undefined;
  let exhausted = false;
  for (let page = 0; page < maxPages; page++) {
    const batch = await input.rpc.getSignaturesForAddress(input.poolWallet, {
      limit: pageSize,
      ...(before ? { before } : {}),
      ...(input.cursor ? { until: input.cursor } : {}),
    });
    collected.push(...batch);
    const last = batch[batch.length - 1];
    const reachedOld =
      last?.blockTime !== null &&
      last?.blockTime !== undefined &&
      last.blockTime * 1000 < input.notBeforeMs;
    if (batch.length < pageSize || reachedOld || !last) {
      exhausted = true;
      break;
    }
    before = last.signature;
  }

  // A backlog larger than one run can page through is not processed at all:
  // advancing the cursor over the newest page would skip older, unfetched
  // transfers forever. The administrator sees `backlog_exceeds_run` instead.
  if (!exhausted) {
    return {
      scanned: collected.length,
      processed: 0,
      recorded: 0,
      newCursor: input.cursor,
      complete: false,
      backlog: true,
    };
  }

  // Oldest first; skip what predates the reward system entirely.
  const ordered = collected
    .filter(
      (s) =>
        s.blockTime === null ||
        s.blockTime === undefined ||
        s.blockTime * 1000 >= input.notBeforeMs,
    )
    .reverse();
  let processed = 0;
  let recorded = 0;
  let newCursor = input.cursor;
  for (const info of ordered.slice(0, maxTransactions)) {
    // Only finalized transactions are ever considered.
    if (info.confirmationStatus && info.confirmationStatus !== "finalized") break;
    if (info.err === null || info.err === undefined) {
      const tx = await input.rpc.getTransaction(info.signature, "finalized");
      if (!tx) break; // not yet visible at finalized: stop and retry next run
      const rows = feeTransfersOf(info.signature, tx, input.poolWallet, input.allowlist);
      if (rows.length) {
        await input.store.insertFeeTransfers(rows);
        recorded += rows.length;
      }
    }
    processed += 1;
    newCursor = info.signature;
  }
  return {
    scanned: collected.length,
    processed,
    recorded,
    newCursor,
    complete: processed === ordered.length,
    backlog: false,
  };
}
