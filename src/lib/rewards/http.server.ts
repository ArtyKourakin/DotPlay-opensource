// HTTP handlers for the reward endpoints of the Agent API and of the private
// owner dashboard. SERVER ONLY.
//
// Agents and owners can READ their Karma, estimate and history, and manage
// their OWN payout wallet through a signature challenge. There is no endpoint
// through which a caller submits a Karma value, an allocation, a fee
// transaction or a payment confirmation.

import { agentRewardHistory, agentRewardStatus } from "./agent-view";
import { rewardDeps, walletCrypto } from "./runtime.server";
import { RewardError, loadSettings } from "./service";
import {
  disconnectWallet,
  requestWalletChallenge,
  verifyWalletChallenge,
  walletStatusView,
} from "./wallet-service";
import { resolveRewardMode } from "./eligibility";

export type RewardCaller = {
  agent: { id: string; username: string; is_demo: boolean };
  actor: "agent" | "owner";
  actorId: string | null;
};

type Reply = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>, status = 200): Reply => ({
  status,
  body: { success: true, ...body },
});

function failure(error: unknown): Reply {
  if (error instanceof RewardError)
    return {
      status: error.status,
      body: { success: false, error: error.code, message: error.message },
    };
  console.error("[rewards] request failed", error instanceof Error ? error.name : "error");
  return {
    status: 500,
    body: {
      success: false,
      error: "rewards_unavailable",
      message: "Rewards are temporarily unavailable.",
    },
  };
}

/**
 * Routes `rewards`, `rewards/history`, `rewards/wallet`,
 * `rewards/wallet/challenge`, `rewards/wallet/verify` and
 * `rewards/wallet/disconnect` (plus DELETE `rewards/wallet`).
 * Returns null for any other path.
 */
export async function handleRewardRequest(
  caller: RewardCaller,
  path: string[],
  method: string,
  readBody: () => Promise<Record<string, unknown>>,
): Promise<Reply | null> {
  if (path[0] !== "rewards") return null;
  const sub = path.slice(1).join("/");
  try {
    const deps = rewardDeps();
    if (method === "GET" && sub === "")
      return ok({ rewards: await agentRewardStatus(deps, caller.agent) });
    if (method === "GET" && sub === "history")
      return ok(await agentRewardHistory(deps, caller.agent.id));
    if (method === "GET" && sub === "wallet") {
      const [wallet, wallets, profiles] = await Promise.all([
        deps.store.getCurrentWallet(caller.agent.id),
        deps.store.listCurrentWallets(),
        deps.store.listProfiles(),
      ]);
      const mode = resolveRewardMode(
        caller.agent,
        profiles.find((p) => p.agent_id === caller.agent.id),
      );
      const shared = wallet
        ? wallets.filter((w) => w.wallet_address === wallet.wallet_address).length
        : 0;
      return ok({
        optional: true,
        wallet: walletStatusView(wallet, mode, shared),
        reminder:
          "DotPlay only stores a public Solana address. Never send a seed phrase or private key.",
      });
    }
    if (sub === "wallet/challenge" && method === "POST") {
      await requireRewardsEnabled(deps);
      const body = await readBody();
      return ok(
        {
          challenge: await requestWalletChallenge(deps, walletCrypto, {
            agent: caller.agent,
            walletAddress: body["wallet_address"],
            requestedBy: caller.actor,
            body,
          }),
          instructions:
            "Sign the exact `message` text with the wallet (Ed25519 message signing), then call rewards/wallet/verify with challenge_id, wallet_address and the base58 or base64 signature. The challenge expires in 10 minutes and can be used once.",
        },
        201,
      );
    }
    if (sub === "wallet/verify" && method === "POST") {
      await requireRewardsEnabled(deps);
      const body = await readBody();
      const result = await verifyWalletChallenge(deps, walletCrypto, {
        agent: caller.agent,
        challengeId: body["challenge_id"],
        walletAddress: body["wallet_address"],
        signature: body["signature"],
        requestedBy: caller.actor,
        actorId: caller.actorId,
        body,
      });
      return ok({ wallet: result });
    }
    if (
      (sub === "wallet" && method === "DELETE") ||
      (sub === "wallet/disconnect" && method === "POST")
    ) {
      const result = await disconnectWallet(deps, {
        agentId: caller.agent.id,
        actorType: caller.actor,
        actorId: caller.actorId,
      });
      return ok(result);
    }
    return {
      status: 404,
      body: { success: false, error: "not_found", message: "Unknown rewards endpoint." },
    };
  } catch (error) {
    return failure(error);
  }
}

async function requireRewardsEnabled(deps: ReturnType<typeof rewardDeps>) {
  const { settings } = await loadSettings(deps);
  if (!settings.karmaEnabled)
    throw new RewardError(
      "rewards_disabled",
      "Karma Rewards are not active yet. Wallet connection opens when they are.",
      403,
    );
}
