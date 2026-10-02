import { describe, expect, test } from "bun:test";
import { generateKeyPair, signBytes } from "@solana/keys";
import { address, getAddressFromPublicKey, getProgramDerivedAddress } from "@solana/addresses";
import { getBase58Decoder } from "@solana/codecs-strings";
import {
  decodeSignature,
  isKeypairBytes,
  signatureFieldIsSecretKey,
  validateWalletAddress,
  verifyWalletSignature,
} from "../solana.server";
import {
  bodyContainsSecretMaterial,
  buildChallengeMessage,
  looksLikeSecretMaterial,
} from "../wallet";
import {
  adminAssignWallet,
  adminRevokeWallet,
  disconnectWallet,
  requestWalletChallenge,
  verifyWalletChallenge,
  type WalletCrypto,
} from "../wallet-service";
import { RewardError } from "../service";
import { agent, makeDb, makeDeps } from "./fakes";

const crypto: WalletCrypto = {
  validateWalletAddress,
  verifyWalletSignature,
  signatureFieldIsSecretKey,
  randomNonce: () => `nonce-${Math.random().toString(16).slice(2)}`,
};

async function wallet() {
  const pair = await generateKeyPair();
  const address = await getAddressFromPublicKey(pair.publicKey);
  const sign = async (message: string) => {
    const bytes = await signBytes(pair.privateKey, new TextEncoder().encode(message));
    return getBase58Decoder().decode(bytes);
  };
  return { address, sign };
}

async function refused(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof RewardError ? error.code : `unexpected:${String(error)}`;
  }
  return "not_refused";
}

const SEED_PHRASE =
  "abandon ability able about above absent absorb abstract absurd abuse access accident";

describe("addresses and secret material", () => {
  test("valid public addresses pass the Solana library check; malformed ones fail", async () => {
    const w = await wallet();
    expect(validateWalletAddress(w.address).ok).toBe(true);
    for (const bad of [
      "",
      "not-an-address",
      "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl",
      "11111111111111111111111111111111111111111111111",
      42,
      null,
    ]) {
      expect(validateWalletAddress(bad).ok).toBe(false);
    }
  });
  test("program-derived (off-curve) addresses are refused as payout wallets", async () => {
    const [pda] = await getProgramDerivedAddress({
      programAddress: address("11111111111111111111111111111111"),
      seeds: ["karma-test"],
    });
    expect(validateWalletAddress(pda).ok).toBe(false);
  });
  test("seed phrases, keypair files and hex or base58 private keys are detected", async () => {
    const secretKeyBytes = new Uint8Array(64).map((_, i) => i);
    expect(looksLikeSecretMaterial(SEED_PHRASE)).toBe(true);
    expect(looksLikeSecretMaterial(JSON.stringify(Array.from(secretKeyBytes)))).toBe(true);
    expect(looksLikeSecretMaterial("a".repeat(64))).toBe(true);
    expect(looksLikeSecretMaterial(getBase58Decoder().decode(secretKeyBytes))).toBe(true);
    expect(looksLikeSecretMaterial("my private key is xyz")).toBe(true);
    expect(looksLikeSecretMaterial((await wallet()).address)).toBe(false);
    expect(bodyContainsSecretMaterial({ wallet_address: "x", nested: { note: SEED_PHRASE } })).toBe(
      true,
    );
  });
  test("a real keypair pasted into a signature field is recognised; a signature is not", async () => {
    const w = await wallet();
    const signature = await w.sign("hello");
    expect(await signatureFieldIsSecretKey(signature)).toBe(false);
    // Build a 64-byte Solana secret key (seed ‖ public key) with WebCrypto.
    const pair = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(
      await globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey),
    );
    const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey));
    const secret = new Uint8Array([...pkcs8.slice(-32), ...raw]);
    expect(await isKeypairBytes(secret)).toBe(true);
    expect(await signatureFieldIsSecretKey(getBase58Decoder().decode(secret))).toBe(true);
  });
  test("signatures decode from base58 or base64 and must be 64 bytes", async () => {
    const w = await wallet();
    const sig58 = await w.sign("m");
    const bytes = decodeSignature(sig58)!;
    expect(bytes.length).toBe(64);
    expect(decodeSignature(btoa(String.fromCharCode(...bytes)))!.length).toBe(64);
    expect(decodeSignature("abc")).toBeNull();
  });
});

describe("agent signature challenge", () => {
  const setup = () => {
    const db = makeDb({ agents: [agent("a1"), agent("a2")] });
    return { db, deps: makeDeps(db) };
  };

  test("an agent requests a challenge, signs it, and its wallet becomes signature_verified", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const challenge = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: { wallet_address: w.address },
    });
    expect(challenge.message).toContain(`Wallet: ${w.address}`);
    expect(challenge.message).toContain("does not authorize any transaction");
    const result = await verifyWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      challengeId: challenge.challenge_id,
      walletAddress: w.address,
      signature: await w.sign(challenge.message),
      requestedBy: "agent",
      actorId: "a1",
      body: {},
    });
    expect(result.status).toBe("signature_verified");
    expect(db.wallets[0]).toEqual(
      expect.objectContaining({
        agent_id: "a1",
        wallet_address: w.address,
        status: "signature_verified",
        verification_method: "agent_signature",
        is_current: true,
      }) as never,
    );
    expect(db.audit.some((e) => e.action === "wallet.connected" && e.agent_id === "a1")).toBe(true);
    // The private challenge row is consumed on first use and stores the nonce's hash.
    expect(db.nonces[0]!.consumed_at).not.toBeNull();
    expect(db.nonces[0]!.nonce_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a challenge can be used once", async () => {
    const { deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    const input = {
      agent: { id: "a1", username: "a1" },
      challengeId: c.challenge_id,
      walletAddress: w.address,
      signature: await w.sign(c.message),
      requestedBy: "agent" as const,
      actorId: "a1",
      body: {},
    };
    await verifyWalletChallenge(deps, crypto, input);
    expect(await refused(verifyWalletChallenge(deps, crypto, input))).toBe("invalid_challenge");
  });

  test("an expired challenge is refused", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    db.now = new Date(db.now.getTime() + 11 * 60_000);
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          challengeId: c.challenge_id,
          walletAddress: w.address,
          signature: await w.sign(c.message),
          requestedBy: "agent",
          actorId: "a1",
          body: {},
        }),
      ),
    ).toBe("invalid_challenge");
  });

  test("an invalid signature is refused, the challenge is burned, and nothing is stored", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const other = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          challengeId: c.challenge_id,
          walletAddress: w.address,
          signature: await other.sign(c.message),
          requestedBy: "agent",
          actorId: "a1",
          body: {},
        }),
      ),
    ).toBe("invalid_signature");
    expect(db.wallets).toHaveLength(0);
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          challengeId: c.challenge_id,
          walletAddress: w.address,
          signature: await w.sign(c.message),
          requestedBy: "agent",
          actorId: "a1",
          body: {},
        }),
      ),
    ).toBe("invalid_challenge");
  });

  test("a signature over a different message is refused", async () => {
    const { deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          challengeId: c.challenge_id,
          walletAddress: w.address,
          signature: await w.sign(`${c.message}!`),
          requestedBy: "agent",
          actorId: "a1",
          body: {},
        }),
      ),
    ).toBe("invalid_signature");
  });

  test("an agent cannot use another agent's challenge or connect a wallet for it", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a2", username: "a2" },
          challengeId: c.challenge_id,
          walletAddress: w.address,
          signature: await w.sign(c.message),
          requestedBy: "agent",
          actorId: "a2",
          body: {},
        }),
      ),
    ).toBe("invalid_challenge");
    expect(db.wallets).toHaveLength(0);
  });

  test("the challenge is bound to one wallet", async () => {
    const { deps } = setup();
    const w = await wallet();
    const other = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    expect(
      await refused(
        verifyWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          challengeId: c.challenge_id,
          walletAddress: other.address,
          signature: await other.sign(c.message),
          requestedBy: "agent",
          actorId: "a1",
          body: {},
        }),
      ),
    ).toBe("invalid_challenge");
  });

  test("seed phrases and private keys are refused before anything is stored", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    expect(
      await refused(
        requestWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          walletAddress: w.address,
          requestedBy: "agent",
          body: { wallet_address: w.address, seed_phrase: SEED_PHRASE },
        }),
      ),
    ).toBe("secret_material_rejected");
    expect(
      await refused(
        requestWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          walletAddress: SEED_PHRASE,
          requestedBy: "agent",
          body: { wallet_address: SEED_PHRASE },
        }),
      ),
    ).toBe("secret_material_rejected");
    expect(db.nonces).toHaveLength(0);
    expect(db.wallets).toHaveLength(0);
    expect(JSON.stringify(db)).not.toContain("abandon ability");
  });

  test("challenge requests are rate limited", async () => {
    const { deps } = setup();
    const w = await wallet();
    for (let i = 0; i < 10; i++)
      await requestWalletChallenge(deps, crypto, {
        agent: { id: "a1", username: "a1" },
        walletAddress: w.address,
        requestedBy: "agent",
        body: {},
      });
    expect(
      await refused(
        requestWalletChallenge(deps, crypto, {
          agent: { id: "a1", username: "a1" },
          walletAddress: w.address,
          requestedBy: "agent",
          body: {},
        }),
      ),
    ).toBe("rate_limited");
  });

  test("the owner-dashboard flow stores owner_verified", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "owner",
      body: {},
    });
    expect(c.message).toContain("the owner (owner dashboard)");
    await verifyWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      challengeId: c.challenge_id,
      walletAddress: w.address,
      signature: await w.sign(c.message),
      requestedBy: "owner",
      actorId: "owner_session:s1",
      body: {},
    });
    expect(db.wallets[0]).toEqual(
      expect.objectContaining({
        status: "owner_verified",
        verification_method: "owner_signature",
      }) as never,
    );
  });

  test("disconnecting keeps the history as revoked", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const c = await requestWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      walletAddress: w.address,
      requestedBy: "agent",
      body: {},
    });
    await verifyWalletChallenge(deps, crypto, {
      agent: { id: "a1", username: "a1" },
      challengeId: c.challenge_id,
      walletAddress: w.address,
      signature: await w.sign(c.message),
      requestedBy: "agent",
      actorId: "a1",
      body: {},
    });
    expect(
      await disconnectWallet(deps, { agentId: "a1", actorType: "agent", actorId: "a1" }),
    ).toEqual({ disconnected: true });
    expect(db.wallets[0]).toEqual(
      expect.objectContaining({ status: "revoked", is_current: false }) as never,
    );
  });

  test("the message names the agent, the wallet, the network and the expiry", () => {
    const message = buildChallengeMessage({
      agentId: "id",
      username: "pixelscout",
      walletAddress: "W",
      requestedBy: "agent",
      nonce: "n",
      issuedAt: new Date("2026-10-01T00:00:00Z"),
      network: "mainnet-beta",
    });
    expect(message).toContain("Agent: @pixelscout");
    expect(message).toContain("Network: mainnet-beta");
    expect(message).toContain("Expires At: 2026-10-01T00:10:00.000Z");
    expect(message).toContain("never ask for your seed phrase");
  });
});

describe("administrator wallet assignment", () => {
  const setup = () => {
    const db = makeDb({
      agents: [
        agent("pixel", { is_demo: true, demo_persona_key: "pixelscout", username: "pixelscout" }),
        agent("real"),
      ],
      profiles: [
        {
          agent_id: "pixel",
          reward_mode: "pilot",
          monetary_enabled: true,
          admin_notes: null,
          updated_at: null,
        },
      ],
    });
    return { db, deps: makeDeps(db) };
  };

  test("a global administrator assigns a pilot wallet with an audit entry", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    const result = await adminAssignWallet(deps, crypto, {
      agentId: "pixel",
      walletAddress: w.address,
      status: "admin_verified_pilot",
      confirm: false,
      reason: "pilot wallet from ops ticket 12",
      adminId: "admin-1",
      body: {},
    });
    expect(result.saved).toBe(true);
    expect(db.wallets[0]).toEqual(
      expect.objectContaining({
        status: "admin_verified_pilot",
        verification_method: "admin_pilot",
      }) as never,
    );
    const entry = db.audit.find((e) => e.action === "wallet.connected")!;
    expect(entry).toEqual(
      expect.objectContaining({
        actor_type: "admin",
        actor_id: "admin-1",
        reason: "pilot wallet from ops ticket 12",
      }) as never,
    );
  });

  test("admin_verified_pilot is refused for a real agent or a non-pilot agent", async () => {
    const { db, deps } = setup();
    const w = await wallet();
    expect(
      await refused(
        adminAssignWallet(deps, crypto, {
          agentId: "real",
          walletAddress: w.address,
          status: "admin_verified_pilot",
          confirm: true,
          reason: "x",
          adminId: "admin",
          body: {},
        }),
      ),
    ).toBe("pilot_exception_not_allowed");
    db.profiles[0]!.reward_mode = "karma_only";
    expect(
      await refused(
        adminAssignWallet(deps, crypto, {
          agentId: "pixel",
          walletAddress: w.address,
          status: "admin_verified_pilot",
          confirm: true,
          reason: "x",
          adminId: "admin",
          body: {},
        }),
      ),
    ).toBe("pilot_exception_not_allowed");
    expect(db.wallets).toHaveLength(0);
  });

  test("invalid addresses and secrets are refused and never stored", async () => {
    const { db, deps } = setup();
    expect(
      await refused(
        adminAssignWallet(deps, crypto, {
          agentId: "pixel",
          walletAddress: "0xc82b551c476eb53b381f8f88f70bdef8cd7b1eb3",
          status: "submitted",
          confirm: true,
          reason: "x",
          adminId: "a",
          body: {},
        }),
      ),
    ).toBe("invalid_wallet_address");
    expect(
      await refused(
        adminAssignWallet(deps, crypto, {
          agentId: "pixel",
          walletAddress: SEED_PHRASE,
          status: "submitted",
          confirm: true,
          reason: "x",
          adminId: "a",
          body: { walletAddress: SEED_PHRASE },
        }),
      ),
    ).toBe("secret_material_rejected");
    expect(db.wallets).toHaveLength(0);
  });

  test("replacing a wallet or sharing one needs explicit confirmation", async () => {
    const { db, deps } = setup();
    const w1 = await wallet();
    const w2 = await wallet();
    await adminAssignWallet(deps, crypto, {
      agentId: "pixel",
      walletAddress: w1.address,
      status: "admin_verified_pilot",
      confirm: false,
      reason: "first",
      adminId: "a",
      body: {},
    });
    const unconfirmed = await adminAssignWallet(deps, crypto, {
      agentId: "pixel",
      walletAddress: w2.address,
      status: "admin_verified_pilot",
      confirm: false,
      reason: "replace",
      adminId: "a",
      body: {},
    });
    expect(unconfirmed).toEqual(
      expect.objectContaining({ saved: false, requires_confirmation: true }) as never,
    );
    const shared = await adminAssignWallet(deps, crypto, {
      agentId: "real",
      walletAddress: w1.address,
      status: "submitted",
      confirm: false,
      reason: "shared",
      adminId: "a",
      body: {},
    });
    expect((shared as { warnings: string[] }).warnings.join(" ")).toContain("wallet-level cap");
    await adminAssignWallet(deps, crypto, {
      agentId: "pixel",
      walletAddress: w2.address,
      status: "admin_verified_pilot",
      confirm: true,
      reason: "replace",
      adminId: "a",
      body: {},
    });
    expect(db.wallets.map((w) => [w.wallet_address, w.status, w.is_current])).toEqual([
      [w1.address, "revoked", false],
      [w2.address, "admin_verified_pilot", true],
    ]);
  });

  test("revocation requires a reason and a confirmation", async () => {
    const { deps } = setup();
    const w = await wallet();
    await adminAssignWallet(deps, crypto, {
      agentId: "pixel",
      walletAddress: w.address,
      status: "admin_verified_pilot",
      confirm: false,
      reason: "first",
      adminId: "a",
      body: {},
    });
    expect(
      await refused(
        adminRevokeWallet(deps, { agentId: "pixel", adminId: "a", reason: "  ", confirm: true }),
      ),
    ).toBe("reason_required");
    expect(
      await refused(
        adminRevokeWallet(deps, { agentId: "pixel", adminId: "a", reason: "lost", confirm: false }),
      ),
    ).toBe("confirmation_required");
    await adminRevokeWallet(deps, {
      agentId: "pixel",
      adminId: "a",
      reason: "lost",
      confirm: true,
    });
  });
});
