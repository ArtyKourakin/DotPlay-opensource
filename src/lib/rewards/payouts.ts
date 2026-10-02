// Admin-reviewed payouts. No private key exists anywhere on the server.
//
//   1. An approved epoch's payable allocations become a payout batch with a
//      deterministic plan (JSON + CSV) and a SHA-256 checksum.
//   2. The administrator sends each transfer from the Reward Pool wallet with
//      their own wallet (Phantom, Solflare, the Solana CLI, ...).
//   3. The administrator submits each transaction signature. The server looks
//      the transaction up and records it only when it contains the exact
//      transfer — pool wallet → snapshotted recipient, exact lamports.
//   4. A payout becomes `confirmed` (and its allocation `paid`) only at
//      `finalized` commitment. Until then it stays `submitted` and the
//      scheduler re-checks it.
//
// Double payment is impossible by construction: one live payout per
// allocation, one on-chain transfer per payout (unique indexes), finalized
// allocations are immutable, and a submitted payout can only be released for
// a retry once its transaction is proven absent or failed.

import { formatSol, solscanTxUrl, type EffectiveRewardSettings } from "./config";
import { findPayoutTransfer } from "./fees";
import { sha256Hex } from "./fingerprint";
import type { PayoutPlanItem, PayoutRow, RewardDeps, StoredAllocation } from "./ports";
import { RewardError } from "./service";

export type PayoutPlan = {
  epoch_key: string;
  network: string;
  source_wallet: string;
  items: (PayoutPlanItem & { agent_username: string })[];
  total_lamports: bigint;
  checksum: string;
};

/** Deterministic plan: payable, finalized allocations ordered by recipient then allocation id. */
export async function buildPayoutPlan(input: {
  epochKey: string;
  network: string;
  sourceWallet: string;
  allocations: readonly StoredAllocation[];
  usernames: ReadonlyMap<string, string>;
  alreadyLive: ReadonlySet<string>;
}): Promise<PayoutPlan> {
  const items = input.allocations
    .filter(
      (a) =>
        a.status === "payable" &&
        a.finalized_at &&
        a.payable_lamports > 0n &&
        a.wallet_address &&
        !input.alreadyLive.has(a.id),
    )
    .map((a) => ({
      allocation_id: a.id,
      recipient_address: a.wallet_address!,
      lamports: a.payable_lamports,
      agent_username: input.usernames.get(a.agent_id) ?? a.agent_id,
    }))
    .sort((x, y) =>
      x.recipient_address === y.recipient_address
        ? x.allocation_id.localeCompare(y.allocation_id)
        : x.recipient_address.localeCompare(y.recipient_address),
    );
  const total = items.reduce((s, i) => s + i.lamports, 0n);
  const canonical = JSON.stringify({
    epoch_key: input.epochKey,
    network: input.network,
    source_wallet: input.sourceWallet,
    items: items.map((i) => [i.allocation_id, i.recipient_address, i.lamports.toString()]),
  });
  return {
    epoch_key: input.epochKey,
    network: input.network,
    source_wallet: input.sourceWallet,
    items,
    total_lamports: total,
    checksum: await sha256Hex(canonical),
  };
}

export function planToCsv(plan: PayoutPlan, payouts: readonly PayoutRow[] = []): string {
  const byAllocation = new Map(payouts.map((p) => [p.allocation_id, p]));
  const header = "payout_id,allocation_id,agent,recipient_address,lamports,sol";
  const rows = plan.items.map((i) =>
    [
      byAllocation.get(i.allocation_id)?.id ?? "",
      i.allocation_id,
      i.agent_username,
      i.recipient_address,
      i.lamports.toString(),
      formatSol(i.lamports),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export function planToCliCommands(plan: PayoutPlan): string[] {
  const url = plan.network === "mainnet-beta" ? "mainnet-beta" : plan.network;
  return plan.items.map(
    (i) =>
      `solana transfer --url ${url} --allow-unfunded-recipient ${i.recipient_address} ${formatSol(i.lamports)}`,
  );
}

async function usernames(deps: RewardDeps) {
  const agents = await deps.store.listAgents();
  return new Map(agents.map((a) => [a.id, a.username]));
}

export async function createPayoutBatch(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  input: { epochId: string; adminId: string; reason: string },
) {
  if (!settings.distributionEnabled)
    throw new RewardError("distribution_disabled", "Financial distribution is disabled.");
  if (!settings.poolWalletAddress)
    throw new RewardError("pool_not_configured", "The Reward Pool wallet is not configured.");
  const epoch = await deps.store.getEpoch(input.epochId);
  if (!epoch) throw new RewardError("not_found", "Epoch not found.", 404);
  if (!(epoch.state === "approved" || (epoch.state === "failed" && epoch.approved_at)))
    throw new RewardError("invalid_state", "Only an approved epoch can be paid.");
  const [allocations, live, names] = await Promise.all([
    deps.store.listAllocations(epoch.id),
    deps.store.listPayouts({ epochId: epoch.id, status: ["pending", "submitted", "confirmed"] }),
    usernames(deps),
  ]);
  const plan = await buildPayoutPlan({
    epochKey: epoch.epoch_key,
    network: settings.network,
    sourceWallet: settings.poolWalletAddress,
    allocations,
    usernames: names,
    alreadyLive: new Set(live.map((p) => p.allocation_id)),
  });
  if (plan.items.length === 0)
    throw new RewardError("nothing_to_pay", "No payable allocation is left in this epoch.");
  const batchId = await deps.store.createPayoutBatch({
    epochId: epoch.id,
    adminId: input.adminId,
    sourceWallet: plan.source_wallet,
    network: plan.network,
    checksum: plan.checksum,
    items: plan.items.map(({ allocation_id, recipient_address, lamports }) => ({
      allocation_id,
      recipient_address,
      lamports,
    })),
  });
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    epoch_id: epoch.id,
    action: "payout.batch_created",
    reason: input.reason,
    new_values: {
      batch_id: batchId,
      payouts: plan.items.length,
      total_lamports: plan.total_lamports.toString(),
      checksum: plan.checksum,
    },
  });
  return { batchId, plan };
}

export async function exportPayoutPlan(deps: RewardDeps, batchId: string) {
  const batch = await deps.store.getBatch(batchId);
  if (!batch) throw new RewardError("not_found", "Batch not found.", 404);
  const epoch = await deps.store.getEpoch(batch.epoch_id);
  const [payouts, names] = await Promise.all([
    deps.store.listPayouts({ batchId }),
    usernames(deps),
  ]);
  const items = payouts
    .map((p) => ({
      allocation_id: p.allocation_id,
      recipient_address: p.recipient_address,
      lamports: p.lamports,
      agent_username: names.get(p.agent_id) ?? p.agent_id,
    }))
    .sort((x, y) =>
      x.recipient_address === y.recipient_address
        ? x.allocation_id.localeCompare(y.allocation_id)
        : x.recipient_address.localeCompare(y.recipient_address),
    );
  const plan: PayoutPlan = {
    epoch_key: epoch?.epoch_key ?? "",
    network: batch.network,
    source_wallet: batch.source_wallet_address,
    items,
    total_lamports: items.reduce((s, i) => s + i.lamports, 0n),
    checksum: batch.plan_checksum,
  };
  return {
    batch,
    plan,
    json: {
      epoch_key: plan.epoch_key,
      network: plan.network,
      source_wallet: plan.source_wallet,
      checksum: plan.checksum,
      total_lamports: plan.total_lamports.toString(),
      total_sol: formatSol(plan.total_lamports),
      payouts: payouts.map((p) => ({
        payout_id: p.id,
        allocation_id: p.allocation_id,
        agent: names.get(p.agent_id) ?? p.agent_id,
        recipient_address: p.recipient_address,
        lamports: p.lamports.toString(),
        sol: formatSol(p.lamports),
        status: p.status,
        tx_signature: p.tx_signature,
      })),
    },
    csv: planToCsv(plan, payouts),
    cli: planToCliCommands(plan),
  };
}

export type SignatureCrypto = {
  isValidTransactionSignature: (value: unknown) => value is string;
  signatureFieldIsSecretKey: (value: unknown) => Promise<boolean>;
};

/**
 * Records a transaction signature against one or more payouts of a batch.
 * Each payout must match its own transfer inside that transaction.
 */
export async function submitPayoutSignature(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
  crypto: SignatureCrypto,
  input: { payoutIds: string[]; signature: string; adminId: string; reason: string },
) {
  if (!settings.distributionEnabled)
    throw new RewardError("distribution_disabled", "Financial distribution is disabled.");
  if (!deps.rpc || !settings.poolWalletAddress)
    throw new RewardError("rpc_not_configured", "Solana RPC or the pool wallet is not configured.");
  if (await crypto.signatureFieldIsSecretKey(input.signature))
    throw new RewardError(
      "secret_material_rejected",
      "That value is a private key, not a transaction signature. It was not stored. Move the funds in that wallet to a new wallet if the key was exposed.",
    );
  if (!crypto.isValidTransactionSignature(input.signature))
    throw new RewardError("invalid_signature", "Provide a valid Solana transaction signature.");
  const signature = input.signature.trim();
  if (input.payoutIds.length === 0 || input.payoutIds.length > 20)
    throw new RewardError("validation_failed", "Select between 1 and 20 payouts.");

  let tx;
  try {
    tx = await deps.rpc.getTransaction(signature, "confirmed");
  } catch {
    throw new RewardError(
      "rpc_failed",
      "The Solana RPC request failed. Nothing was recorded; retry shortly.",
      503,
    );
  }
  // Nothing is stored for a signature the network does not know: a mistyped or
  // wrong value never enters the database.
  if (!tx)
    throw new RewardError(
      "tx_not_found",
      "This transaction is not visible yet. Wait a few seconds and retry.",
    );

  const results: { payout_id: string; status: string }[] = [];
  const claimed = new Set<string>();
  for (const payoutId of input.payoutIds) {
    const payout = await deps.store.getPayout(payoutId);
    if (!payout) throw new RewardError("not_found", "Payout not found.", 404);
    if (payout.status === "confirmed") {
      results.push({ payout_id: payout.id, status: "already_confirmed" });
      continue;
    }
    if (payout.status !== "pending" && payout.status !== "submitted")
      throw new RewardError("invalid_state", `Payout ${payout.id} is ${payout.status}.`);
    const batch = await deps.store.getBatch(payout.batch_id);
    if (!batch || batch.status !== "prepared")
      throw new RewardError("invalid_state", "The payout batch is not open.");
    const used = await deps.store.usedTransferIndexes(signature, payout.id);
    for (const c of claimed) used.add(c);
    const check = findPayoutTransfer({
      tx,
      finalized: true, // shape check here; finality is established below
      poolWallet: settings.poolWalletAddress,
      recipient: payout.recipient_address,
      lamports: payout.lamports,
      notBefore: batch.created_at,
      usedTransferIndexes: used,
    });
    if (!check.ok)
      throw new RewardError(
        check.code,
        `Transaction does not contain the expected transfer for payout ${payout.id} (${check.code}). Nothing was recorded.`,
      );
    claimed.add(check.transfer_index);
    const ok = await deps.store.updatePayout(payout.id, ["pending", "submitted"], {
      status: "submitted",
      tx_signature: signature,
      transfer_index: check.transfer_index,
      submitted_at: deps.now().toISOString(),
      submitted_by: input.adminId,
      last_failure_code: null,
    });
    if (!ok)
      throw new RewardError("concurrent_update", "The payout changed. Reload and retry.", 409);
    await deps.store.audit({
      actor_type: "admin",
      actor_id: input.adminId,
      agent_id: payout.agent_id,
      epoch_id: batch.epoch_id,
      action: "payout.signature_submitted",
      reason: input.reason,
      new_values: {
        payout_id: payout.id,
        tx_signature: signature,
        transfer_index: check.transfer_index,
        lamports: payout.lamports.toString(),
      },
    });
    results.push({ payout_id: payout.id, status: "submitted" });
  }
  const confirmed = await reconcilePayouts(deps, settings);
  return { results, confirmed, explorer_url: solscanTxUrl(signature, settings.network) };
}

/**
 * Re-checks every submitted payout at `finalized` commitment and confirms the
 * ones whose transfer is final. A failed transaction returns its payout to
 * `pending` (with the failure recorded) so it can be paid again safely.
 */
export async function reconcilePayouts(
  deps: RewardDeps,
  settings: EffectiveRewardSettings,
): Promise<number> {
  if (!deps.rpc || !settings.poolWalletAddress) return 0;
  const submitted = await deps.store.listPayouts({ status: ["submitted"] });
  let confirmed = 0;
  for (const payout of submitted) {
    if (!payout.tx_signature || !payout.transfer_index) continue;
    const batch = await deps.store.getBatch(payout.batch_id);
    if (!batch) continue;
    let tx;
    try {
      tx = await deps.rpc.getTransaction(payout.tx_signature, "finalized");
    } catch {
      continue; // RPC trouble: keep it submitted and retry on the next run
    }
    if (!tx) continue; // not finalized yet
    const used = await deps.store.usedTransferIndexes(payout.tx_signature, payout.id);
    const check = findPayoutTransfer({
      tx,
      finalized: true,
      poolWallet: batch.source_wallet_address,
      recipient: payout.recipient_address,
      lamports: payout.lamports,
      notBefore: batch.created_at,
      usedTransferIndexes: used,
    });
    if (check.ok && check.transfer_index === payout.transfer_index) {
      await deps.store.confirmPayout(
        payout.id,
        payout.tx_signature,
        payout.transfer_index,
        check.slot,
      );
      await deps.store.audit({
        actor_type: "system",
        actor_id: null,
        agent_id: payout.agent_id,
        epoch_id: batch.epoch_id,
        action: "payout.confirmed",
        new_values: { payout_id: payout.id, tx_signature: payout.tx_signature, slot: check.slot },
      });
      confirmed += 1;
    } else if (!check.ok && check.code === "tx_failed") {
      await deps.store.updatePayout(payout.id, ["submitted"], {
        status: "pending",
        tx_signature: null,
        transfer_index: null,
        last_failure_code: "tx_failed",
      });
      await deps.store.audit({
        actor_type: "system",
        actor_id: null,
        agent_id: payout.agent_id,
        epoch_id: batch.epoch_id,
        action: "payout.transaction_failed",
        new_values: { payout_id: payout.id, tx_signature: payout.tx_signature },
      });
    }
  }
  return confirmed;
}

/**
 * Returns a submitted payout to `pending` so a replacement transfer can be
 * sent. Allowed only when the recorded transaction is proven not to exist at
 * `confirmed` commitment after its blockhash can no longer land (10 minutes),
 * so the original can never also succeed.
 */
export async function releasePayout(
  deps: RewardDeps,
  input: { payoutId: string; adminId: string; reason: string },
) {
  if (!deps.rpc) throw new RewardError("rpc_not_configured", "Solana RPC is not configured.");
  const payout = await deps.store.getPayout(input.payoutId);
  if (!payout) throw new RewardError("not_found", "Payout not found.", 404);
  if (payout.status !== "submitted" || !payout.tx_signature)
    throw new RewardError("invalid_state", "Only a submitted payout can be released.");
  if (!payout.submitted_at || deps.now().getTime() - Date.parse(payout.submitted_at) < 10 * 60_000)
    throw new RewardError(
      "too_early",
      "Wait at least 10 minutes after submission before releasing a payout.",
    );
  let tx;
  try {
    tx = await deps.rpc.getTransaction(payout.tx_signature, "confirmed");
  } catch {
    throw new RewardError("rpc_failed", "The Solana RPC request failed. Nothing changed.", 503);
  }
  const failed = tx?.meta && tx.meta.err !== null && tx.meta.err !== undefined;
  if (tx && !failed)
    throw new RewardError(
      "tx_exists",
      "The transaction exists on-chain. It will be confirmed at finalization; it cannot be released.",
    );
  const ok = await deps.store.updatePayout(payout.id, ["submitted"], {
    status: "pending",
    tx_signature: null,
    transfer_index: null,
    last_failure_code: failed ? "tx_failed" : "tx_not_found",
  });
  if (!ok) throw new RewardError("concurrent_update", "The payout changed. Reload and retry.", 409);
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    agent_id: payout.agent_id,
    action: "payout.released",
    reason: input.reason,
    previous_values: { status: "submitted", tx_signature: payout.tx_signature },
    new_values: { status: "pending" },
  });
}

/** Cancels an open batch in which nothing was submitted; the epoch returns to `approved`. */
export async function cancelPayoutBatch(
  deps: RewardDeps,
  input: { batchId: string; adminId: string; reason: string },
) {
  const batch = await deps.store.getBatch(input.batchId);
  if (!batch) throw new RewardError("not_found", "Batch not found.", 404);
  if (batch.status !== "prepared")
    throw new RewardError("invalid_state", "Only a prepared batch can be cancelled.");
  const payouts = await deps.store.listPayouts({ batchId: batch.id });
  if (payouts.some((p) => p.status === "submitted" || p.status === "confirmed"))
    throw new RewardError(
      "payouts_in_flight",
      "Some payouts were already submitted or confirmed. Reconcile them instead.",
    );
  for (const p of payouts)
    await deps.store.updatePayout(p.id, ["pending"], { status: "cancelled" });
  await deps.store.updateBatch(batch.id, {
    status: "cancelled",
    cancelled_at: deps.now().toISOString(),
    cancel_reason: input.reason,
  });
  await deps.store.transitionEpoch(batch.epoch_id, "paying", "approved");
  await deps.store.audit({
    actor_type: "admin",
    actor_id: input.adminId,
    epoch_id: batch.epoch_id,
    action: "payout.batch_cancelled",
    reason: input.reason,
    new_values: { batch_id: batch.id },
  });
}
