// Payout-wallet connection flows: agent and owner signature challenges, and the
// administrator assignment used for pilot agents. Dependencies injected.

import type { RewardDeps, WalletRow } from "./ports";
import {
  resolveRewardMode,
  PAYABLE_WALLET_STATUSES,
  isWalletPayable,
  type AgentFacts,
} from "./eligibility";
import { sha256Hex } from "./fingerprint";
import { RewardError } from "./service";
import {
  CHALLENGE_TTL_MS,
  adminMayAssign,
  bodyContainsSecretMaterial,
  buildChallengeMessage,
  statusForMethod,
  type AdminAssignableStatus,
} from "./wallet";

export type WalletCrypto = {
  validateWalletAddress: (
    value: unknown,
  ) => { ok: true; address: string } | { ok: false; code: string; message: string };
  verifyWalletSignature: (address: string, message: string, signature: unknown) => Promise<boolean>;
  signatureFieldIsSecretKey: (value: unknown) => Promise<boolean>;
  randomNonce: () => string;
};

export const SECRET_REJECTION_MESSAGE =
  "That looks like a private key, seed phrase or keypair file. It was not stored. DotPlay only needs your PUBLIC wallet address and a signature. If you shared a secret by mistake, move your funds to a new wallet.";

const CHALLENGES_PER_HOUR = 10;

/** Refuses any request body that carries secret key material, before anything is stored. */
export async function rejectSecretMaterial(body: unknown, crypto: WalletCrypto) {
  if (bodyContainsSecretMaterial(body))
    throw new RewardError("secret_material_rejected", SECRET_REJECTION_MESSAGE);
  const signature =
    body && typeof body === "object" ? (body as Record<string, unknown>)["signature"] : undefined;
  if (signature !== undefined && (await crypto.signatureFieldIsSecretKey(signature)))
    throw new RewardError("secret_material_rejected", SECRET_REJECTION_MESSAGE);
}

/** Safe wallet status for the agent itself or its owner. */
export function walletStatusView(wallet: WalletRow | null, mode: string, sharedWith = 0) {
  if (!wallet)
    return {
      status: "not_configured" as const,
      wallet_address: null,
      verification_method: null,
      verified_at: null,
      payable: false,
      shared_wallet: false,
    };
  return {
    status: wallet.status,
    wallet_address: wallet.wallet_address,
    verification_method: wallet.verification_method,
    verified_at: wallet.verified_at,
    payable: isWalletPayable(wallet, mode as never),
    shared_wallet: sharedWith > 1,
  };
}

export async function requestWalletChallenge(
  deps: RewardDeps,
  crypto: WalletCrypto,
  input: {
    agent: Pick<AgentFacts, "id" | "username">;
    walletAddress: unknown;
    requestedBy: "agent" | "owner";
    body: unknown;
  },
) {
  await rejectSecretMaterial(input.body, crypto);
  const checked = crypto.validateWalletAddress(input.walletAddress);
  if (!checked.ok) throw new RewardError(checked.code, checked.message);
  const now = deps.now();
  const recent = await deps.store.countRecentNonces(
    input.agent.id,
    new Date(now.getTime() - 3_600_000).toISOString(),
  );
  if (recent >= CHALLENGES_PER_HOUR)
    throw new RewardError("rate_limited", "Too many wallet challenges. Try again later.", 429);
  const nonce = crypto.randomNonce();
  const message = buildChallengeMessage({
    agentId: input.agent.id,
    username: input.agent.username,
    walletAddress: checked.address,
    requestedBy: input.requestedBy,
    nonce,
    issuedAt: now,
    network: deps.env.network,
  });
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  const id = await deps.store.createNonce({
    agent_id: input.agent.id,
    wallet_address: checked.address,
    requested_by: input.requestedBy,
    nonce_hash: await sha256Hex(nonce),
    message,
    expires_at: expiresAt,
  });
  return { challenge_id: id, wallet_address: checked.address, message, expires_at: expiresAt };
}

/**
 * Verifies a signed challenge. The challenge is consumed first (one attempt
 * only, whatever the result), must belong to this agent and wallet and must
 * not be expired; only then is the Ed25519 signature checked.
 */
export async function verifyWalletChallenge(
  deps: RewardDeps,
  crypto: WalletCrypto,
  input: {
    agent: Pick<AgentFacts, "id" | "username">;
    challengeId: unknown;
    walletAddress: unknown;
    signature: unknown;
    requestedBy: "agent" | "owner";
    actorId: string | null;
    body: unknown;
  },
) {
  await rejectSecretMaterial(input.body, crypto);
  if (typeof input.challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.challengeId))
    throw new RewardError("invalid_challenge", "Provide the challenge_id you received.");
  const checked = crypto.validateWalletAddress(input.walletAddress);
  if (!checked.ok) throw new RewardError(checked.code, checked.message);
  const nonce = await deps.store.consumeNonce(
    input.challengeId,
    input.agent.id,
    deps.now().toISOString(),
  );
  if (!nonce)
    throw new RewardError(
      "invalid_challenge",
      "The challenge is unknown, expired or already used. Request a new one.",
    );
  if (nonce.wallet_address !== checked.address || nonce.requested_by !== input.requestedBy)
    throw new RewardError(
      "invalid_challenge",
      "The challenge was issued for a different wallet. Request a new one.",
    );
  if (!(await crypto.verifyWalletSignature(checked.address, nonce.message, input.signature))) {
    await deps.store.audit({
      actor_type: input.requestedBy,
      actor_id: input.actorId,
      agent_id: input.agent.id,
      action: "wallet.verification_failed",
      new_values: { wallet_address: checked.address },
    });
    throw new RewardError(
      "invalid_signature",
      "The signature does not match this wallet and challenge.",
    );
  }
  const status = statusForMethod(input.requestedBy);
  const walletId = await deps.store.replaceWallet({
    agentId: input.agent.id,
    address: checked.address,
    status: status as "signature_verified" | "owner_verified",
    method: input.requestedBy === "agent" ? "agent_signature" : "owner_signature",
    actorType: input.requestedBy,
    actorId: input.actorId,
    reason: null,
  });
  return { wallet_id: walletId, wallet_address: checked.address, status };
}

export async function disconnectWallet(
  deps: RewardDeps,
  input: { agentId: string; actorType: "agent" | "owner"; actorId: string | null },
) {
  const changed = await deps.store.revokeCurrentWallet(
    input.agentId,
    input.actorType,
    input.actorId,
    `disconnected_by_${input.actorType}`,
  );
  return { disconnected: changed };
}

export type WalletAssignment = {
  agentId: string;
  walletAddress: unknown;
  status: AdminAssignableStatus;
  confirm: boolean;
  reason: string;
  adminId: string;
  body: unknown;
};

/**
 * An administrator assigns a public payout address. The address is validated
 * with the Solana library; secret material is refused; a replacement or a
 * shared address needs explicit confirmation; `admin_verified_pilot` is only
 * available for a platform test agent in pilot mode. Finalized allocations
 * keep the address snapshotted at calculation, so nothing already approved or
 * paid changes.
 */
export async function adminAssignWallet(
  deps: RewardDeps,
  crypto: WalletCrypto,
  input: WalletAssignment,
) {
  await rejectSecretMaterial(input.body, crypto);
  if (!input.reason.trim()) throw new RewardError("reason_required", "A reason is required.");
  const checked = crypto.validateWalletAddress(input.walletAddress);
  if (!checked.ok) throw new RewardError(checked.code, checked.message);
  const [agents, profiles, current, allCurrent] = await Promise.all([
    deps.store.listAgents(),
    deps.store.listProfiles(),
    deps.store.getCurrentWallet(input.agentId),
    deps.store.listCurrentWallets(),
  ]);
  const agent = agents.find((a) => a.id === input.agentId);
  if (!agent) throw new RewardError("not_found", "Agent not found.", 404);
  const mode = resolveRewardMode(
    agent,
    profiles.find((p) => p.agent_id === agent.id),
  );
  const allowed = adminMayAssign(input.status, agent, mode);
  if (!allowed.ok) throw new RewardError(allowed.code, allowed.message, 403);
  const sharedWith = allCurrent.filter(
    (w) => w.wallet_address === checked.address && w.agent_id !== agent.id,
  );
  const warnings: string[] = [];
  if (current) warnings.push(`replaces ${current.wallet_address} (${current.status})`);
  if (sharedWith.length)
    warnings.push(
      `address already used by ${sharedWith.length} other agent(s); the wallet-level cap applies to all of them together`,
    );
  if (warnings.length && !input.confirm)
    return { saved: false as const, requires_confirmation: true as const, warnings };
  if (current && current.wallet_address === checked.address && current.status === input.status)
    return {
      saved: false as const,
      requires_confirmation: false as const,
      warnings: ["unchanged"],
    };
  const walletId = await deps.store.replaceWallet({
    agentId: agent.id,
    address: checked.address,
    status: input.status,
    method: input.status === "admin_verified_pilot" ? "admin_pilot" : "admin_manual",
    actorType: "admin",
    actorId: input.adminId,
    reason: input.reason.trim(),
  });
  return { saved: true as const, wallet_id: walletId, warnings };
}

export async function adminRevokeWallet(
  deps: RewardDeps,
  input: { agentId: string; adminId: string; reason: string; confirm: boolean },
) {
  if (!input.reason.trim()) throw new RewardError("reason_required", "A reason is required.");
  if (!input.confirm)
    throw new RewardError("confirmation_required", "Confirm the disconnection explicitly.");
  const changed = await deps.store.revokeCurrentWallet(
    input.agentId,
    "admin",
    input.adminId,
    input.reason.trim(),
  );
  if (!changed)
    throw new RewardError("not_found", "This agent has no connected payout wallet.", 404);
}

export function isPayableStatus(status: string | null | undefined): boolean {
  return Boolean(status) && (PAYABLE_WALLET_STATUSES as readonly string[]).includes(status!);
}
