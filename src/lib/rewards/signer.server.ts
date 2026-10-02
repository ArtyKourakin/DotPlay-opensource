// Reward payout signer. SERVER ONLY.
//
// Reads REWARD_PAYOUT_PRIVATE_KEY (base58: 64-byte Solana secret key, or a
// 32-byte Ed25519 seed). Word phrases are refused. The derived public address
// must equal REWARD_POOL_WALLET_ADDRESS or every payout is refused with
// `payout_signer_mismatch`. Key material is never logged or returned; every
// failure is a fixed, safe error code.

import { getAddressFromPublicKey, type Address } from "@solana/addresses";
import { createKeyPairFromBytes, createKeyPairFromPrivateKeyBytes } from "@solana/keys";
import { getBase58Encoder } from "@solana/codecs-strings";

export type SignerCode =
  | "payout_signer_not_configured"
  | "payout_signer_invalid_format"
  | "payout_signer_seed_phrase_refused"
  | "payout_signer_mismatch"
  | "pool_not_configured";

export class SignerError extends Error {
  constructor(readonly code: SignerCode) {
    super(code);
    this.name = "SignerError";
  }
}

export type PayoutSigner = { address: Address; keyPair: CryptoKeyPair };

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export async function loadSignerFromValue(
  raw: string | undefined,
  poolAddress: string | undefined,
): Promise<PayoutSigner> {
  const value = raw?.trim();
  if (!value) throw new SignerError("payout_signer_not_configured");
  if (/\s/.test(value)) throw new SignerError("payout_signer_seed_phrase_refused");
  if (!BASE58.test(value) || value.length > 100) throw new SignerError("payout_signer_invalid_format");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(getBase58Encoder().encode(value));
  } catch {
    throw new SignerError("payout_signer_invalid_format");
  }
  let keyPair: CryptoKeyPair;
  try {
    if (bytes.length === 64) keyPair = await createKeyPairFromBytes(bytes);
    else if (bytes.length === 32) keyPair = await createKeyPairFromPrivateKeyBytes(bytes);
    else throw new Error();
  } catch {
    throw new SignerError("payout_signer_invalid_format");
  } finally {
    bytes.fill(0);
  }
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  if (!poolAddress?.trim()) throw new SignerError("pool_not_configured");
  if (address !== poolAddress.trim()) throw new SignerError("payout_signer_mismatch");
  return { address, keyPair };
}

/** Reads env inside the call (never at module scope). */
export function loadPayoutSigner(): Promise<PayoutSigner> {
  return loadSignerFromValue(
    process.env["REWARD_PAYOUT_PRIVATE_KEY"],
    process.env["REWARD_POOL_WALLET_ADDRESS"],
  );
}

/** Safe status for the admin UI: never includes key material. */
export async function signerStatus(): Promise<{ configured: boolean; matchesPool: boolean; code: SignerCode | null }> {
  const configured = !!process.env["REWARD_PAYOUT_PRIVATE_KEY"]?.trim();
  try {
    await loadPayoutSigner();
    return { configured, matchesPool: true, code: null };
  } catch (e) {
    return { configured, matchesPool: false, code: e instanceof SignerError ? e.code : "payout_signer_invalid_format" };
  }
}
