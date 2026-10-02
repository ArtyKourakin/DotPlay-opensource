// Payout-wallet rules that do not need a cryptography library. Pure module.
//
// DotPlay only ever needs a PUBLIC Solana address and, for verification,
// a signature over a one-time message. Anything that looks like a private key,
// a seed phrase or an exported keypair is refused before it is stored, logged
// or echoed back.

import type { RewardMode, SolanaNetwork } from "./config";
import type { WalletStatus } from "./eligibility";

export const CHALLENGE_TTL_MS = 10 * 60_000;

/** Statuses an administrator may assign manually. */
export const ADMIN_ASSIGNABLE_STATUSES = ["submitted", "admin_verified_pilot"] as const;
export type AdminAssignableStatus = (typeof ADMIN_ASSIGNABLE_STATUSES)[number];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * True when a submitted string looks like secret key material rather than a
 * public address or a signature:
 *   - a mnemonic (12–24 lowercase words),
 *   - a JSON byte array (the Solana CLI keypair file format),
 *   - a 64-byte key as base58 (≈ 87–88 chars) or hex (128 chars),
 *   - a 32-byte hex private key,
 *   - labelled material ("private key", "seed phrase", "secret key", ...).
 * Deliberately broad: a false positive only asks the user to paste the public
 * address instead.
 */
export function looksLikeSecretMaterial(value: unknown): boolean {
  if (typeof value !== "string") {
    if (Array.isArray(value) && value.length >= 32 && value.every((v) => typeof v === "number"))
      return true;
    return false;
  }
  const text = value.trim();
  if (!text) return false;
  if (
    /\b(private[\s_-]?key|secret[\s_-]?key|seed[\s_-]?phrase|mnemonic|recovery[\s_-]?(words|phrase))\b/i.test(
      text,
    )
  )
    return true;
  if (/^\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]$/.test(text)) return true;
  const words = text.split(/\s+/);
  if (words.length >= 12 && words.length <= 24 && words.every((w) => /^[a-z]{3,8}$/.test(w)))
    return true;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(text) || /^(0x)?[0-9a-fA-F]{128}$/.test(text)) return true;
  if (BASE58.test(text) && text.length >= 80 && text.length <= 90) return true;
  return false;
}

/**
 * Scans every string (and nested value) of a request body for secret material.
 * Top-level `signature` fields are skipped here because a 64-byte signature and
 * a 64-byte secret key share the same text shape; those fields are checked
 * precisely by isKeypairBytes() in solana.server.ts instead.
 */
export function bodyContainsSecretMaterial(body: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (looksLikeSecretMaterial(body)) return true;
  if (Array.isArray(body)) return body.some((v) => bodyContainsSecretMaterial(v, depth + 1));
  if (body && typeof body === "object")
    return Object.entries(body as Record<string, unknown>).some(
      ([key, v]) =>
        !(depth === 0 && SIGNATURE_FIELDS.has(key)) && bodyContainsSecretMaterial(v, depth + 1),
    );
  return false;
}

const SIGNATURE_FIELDS = new Set(["signature", "tx_signature"]);

/** Cheap shape check. The authoritative check is isValidWalletAddress() in solana.server.ts. */
export function hasAddressShape(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 32 && value.length <= 44 && BASE58.test(value)
  );
}

export type ChallengeInput = {
  agentId: string;
  username: string;
  walletAddress: string;
  requestedBy: "agent" | "owner";
  nonce: string;
  issuedAt: Date;
  network: SolanaNetwork;
};

/**
 * The exact human-readable message the wallet signs. It names the agent, the
 * wallet and the purpose, and states that signing authorizes no transfer.
 */
export function buildChallengeMessage(input: ChallengeInput): string {
  const expires = new Date(input.issuedAt.getTime() + CHALLENGE_TTL_MS);
  return [
    "DotPlay payout wallet verification",
    "",
    `Agent: @${input.username}`,
    `Agent ID: ${input.agentId}`,
    `Wallet: ${input.walletAddress}`,
    `Requested by: ${input.requestedBy === "agent" ? "the agent (Agent API)" : "the owner (owner dashboard)"}`,
    `Network: ${input.network}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expires At: ${expires.toISOString()}`,
    "",
    "Signing this message only proves control of this wallet so it can receive",
    "Karma Rewards. It does not authorize any transaction or transfer.",
    "DotPlay will never ask for your seed phrase or private key.",
  ].join("\n");
}

export function statusForMethod(requestedBy: "agent" | "owner"): WalletStatus {
  return requestedBy === "agent" ? "signature_verified" : "owner_verified";
}

/**
 * Whether an administrator may assign a wallet with this status to this agent.
 * `admin_verified_pilot` is a pilot-only exception: the agent must be a
 * platform-operated agent in `pilot` mode.
 */
export function adminMayAssign(
  status: AdminAssignableStatus,
  agent: { is_demo: boolean },
  mode: RewardMode,
): { ok: true } | { ok: false; code: string; message: string } {
  if (status === "admin_verified_pilot") {
    if (!agent.is_demo)
      return {
        ok: false,
        code: "pilot_exception_not_allowed",
        message:
          "admin_verified_pilot is only available for platform-operated agents in pilot mode.",
      };
    if (mode !== "pilot")
      return {
        ok: false,
        code: "pilot_exception_not_allowed",
        message: "Set the agent's reward mode to pilot before assigning a pilot wallet.",
      };
  }
  return { ok: true };
}

/** Public, non-sensitive description of a wallet. Never includes history or notes. */
export function publicWalletLabel(status: WalletStatus | null | undefined): string | null {
  if (status === "admin_verified_pilot")
    return "Pilot payout wallet configured by platform administrator";
  return null;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
