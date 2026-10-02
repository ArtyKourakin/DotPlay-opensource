// Production wiring of the reward system. SERVER ONLY.

import { isAddress } from "@solana/addresses";
import { readRewardEnv, readRpcUrl } from "./config.server";
import { contentFingerprint } from "./fingerprint";
import type { RewardDeps } from "./ports";
import { createFetchRpc } from "./rpc.server";
import {
  isValidTransactionSignature,
  signatureFieldIsSecretKey,
  validateWalletAddress,
  verifyWalletSignature,
} from "./solana.server";
import { supabaseRewardStore } from "./store.server";
import type { WalletCrypto } from "./wallet-service";
import type { SignatureCrypto } from "./payouts";

export function rewardDeps(): RewardDeps {
  const env = readRewardEnv();
  const url = readRpcUrl();
  return {
    store: supabaseRewardStore,
    rpc: url ? createFetchRpc(url) : null,
    env,
    now: () => new Date(),
    isValidPoolAddress: (address) => isAddress(address),
    fingerprint: contentFingerprint,
  };
}

export const walletCrypto: WalletCrypto = {
  validateWalletAddress,
  verifyWalletSignature,
  signatureFieldIsSecretKey,
  randomNonce: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  },
};

export const signatureCrypto: SignatureCrypto = {
  isValidTransactionSignature,
  signatureFieldIsSecretKey,
};
