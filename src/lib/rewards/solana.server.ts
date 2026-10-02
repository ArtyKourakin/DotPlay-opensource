// Solana public-key validation and message-signature verification.
// SERVER ONLY. Uses the official @solana/addresses and @solana/keys packages
// (Ed25519 through WebCrypto); no private key is ever handled.

import {
  getPublicKeyFromAddress,
  isAddress,
  isOffCurveAddress,
  type Address,
} from "@solana/addresses";
import { isSignature, signatureBytes, verifySignature } from "@solana/keys";
import { getBase58Encoder, getBase64Encoder } from "@solana/codecs-strings";

export type AddressCheck =
  { ok: true; address: Address } | { ok: false; code: string; message: string };

/**
 * A payout wallet must be a valid base58 32-byte Solana public key that lies on
 * the Ed25519 curve, i.e. an address controlled by a private key. Program
 * derived addresses (off-curve) are refused: they cannot sign a verification
 * message and are not personal wallets.
 */
export function validateWalletAddress(value: unknown): AddressCheck {
  if (typeof value !== "string" || !value.trim())
    return {
      ok: false,
      code: "invalid_wallet_address",
      message: "Provide a Solana public address.",
    };
  const candidate = value.trim();
  if (!isAddress(candidate))
    return {
      ok: false,
      code: "invalid_wallet_address",
      message: "That is not a valid Solana public address.",
    };
  if (isOffCurveAddress(candidate))
    return {
      ok: false,
      code: "invalid_wallet_address",
      message:
        "Use a wallet address controlled by a key (program-derived addresses are not accepted).",
    };
  return { ok: true, address: candidate };
}

export function isValidWalletAddress(value: unknown): boolean {
  return validateWalletAddress(value).ok;
}

export function isValidTransactionSignature(value: unknown): value is string {
  return typeof value === "string" && isSignature(value.trim());
}

/**
 * Decodes a 64-byte Ed25519 signature sent as base58 (Phantom's bs58 output)
 * or base64 (a Uint8Array encoded by a browser). Anything else is refused.
 */
export function decodeSignature(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 128) return null;
  const attempts: (() => Uint8Array)[] = [];
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(text))
    attempts.push(() => new Uint8Array(getBase58Encoder().encode(text)));
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text))
    attempts.push(() => new Uint8Array(getBase64Encoder().encode(text)));
  for (const attempt of attempts) {
    try {
      const bytes = attempt();
      if (bytes.length === 64) return bytes;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

/**
 * True when 64 bytes are a Solana secret keypair (32-byte seed followed by its
 * own public key) rather than a signature. Used to refuse a private key pasted
 * into a signature field; the bytes are discarded either way.
 */
export async function isKeypairBytes(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length !== 64) return false;
  try {
    const { createKeyPairFromBytes } = await import("@solana/keys");
    await createKeyPairFromBytes(bytes, false);
    return true;
  } catch {
    return false;
  }
}

/** Decodes a signature field and reports whether it is actually a secret keypair. */
export async function signatureFieldIsSecretKey(value: unknown): Promise<boolean> {
  if (typeof value !== "string") return false;
  const bytes = decodeSignature(value);
  return bytes ? isKeypairBytes(bytes) : false;
}

/** Verifies that `signature` is `address`'s Ed25519 signature of the UTF-8 `message`. */
export async function verifyWalletSignature(
  address: string,
  message: string,
  signature: unknown,
): Promise<boolean> {
  const checked = validateWalletAddress(address);
  if (!checked.ok) return false;
  const bytes = decodeSignature(signature);
  if (!bytes) return false;
  try {
    const key = await getPublicKeyFromAddress(checked.address);
    return await verifySignature(key, signatureBytes(bytes), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}
