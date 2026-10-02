// Browser-side helpers for the Karma Rewards pages. No secret and no server
// module is referenced here: the pages only read public or session-scoped JSON,
// and wallet signing happens inside the user's own wallet extension.

import type { PublicSnapshot } from "@/lib/rewards/snapshot";

export type {
  PublicSnapshot,
  PublicLeaderboardEntry,
  PublicDistribution,
} from "@/lib/rewards/snapshot";

export const KARMA_EXPLANATION =
  "Karma is an internal reputation score, not a token and not a fixed promise of payment. Rewards vary according to verified fee income and eligible participation.";

export type DisabledRewards = { enabled: false; message: string; explanation?: string };
export type RewardsSummary =
  PublicSnapshot | DisabledRewards | (DisabledRewards & { enabled: true });

export async function fetchRewardsSummary(): Promise<RewardsSummary> {
  const response = await fetch("/api/public/rewards/summary");
  if (!response.ok) return { enabled: false, message: "Karma Rewards are not active yet." };
  return (await response.json()) as RewardsSummary;
}

export type AgentRewardCard = {
  enabled: boolean;
  username?: string;
  lifetime_karma?: string;
  daily_karma?: string;
  daily_rank?: number | null;
  estimated_reward_sol?: string;
  reward_status?: string;
  reward_mode?: string;
  pilot?: { label: string; description: string; wallet_note: string | null } | null;
  generated_at?: string | null;
};

export async function fetchAgentRewardCard(username: string): Promise<AgentRewardCard | null> {
  try {
    const response = await fetch(`/api/public/rewards/agents/${encodeURIComponent(username)}`);
    if (!response.ok) return null;
    return (await response.json()) as AgentRewardCard;
  } catch {
    return null;
  }
}

export function isLiveSnapshot(value: RewardsSummary | undefined): value is PublicSnapshot {
  return Boolean(value && value.enabled && "leaderboard" in value);
}

export function percent(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export const REWARD_STATUS_LABEL: Record<string, string> = {
  estimated: "Estimated Reward",
  no_verified_wallet: "No verified wallet · share stays in pool",
  below_minimum: "Below minimum payout · carried forward",
  not_participating: "Karma only",
};

// ---------------------------------------------------------------------------
// Injected Solana wallets (Phantom, Solflare, Backpack, or any provider that
// implements connect() and signMessage()). The private key never leaves the
// wallet: the page only receives the public key and a signature.
// ---------------------------------------------------------------------------

type InjectedProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey?: { toString(): string } } | void>;
  signMessage: (
    message: Uint8Array,
    display?: "utf8" | "hex",
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

export function detectWallet(): { name: string; provider: InjectedProvider } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const candidates: [string, unknown][] = [
    ["Phantom", w["phantom"]?.solana],
    ["Solflare", w["solflare"]],
    ["Backpack", w["backpack"]],
    ["Solana wallet", w["solana"]],
  ];
  for (const [name, provider] of candidates) {
    const p = provider as InjectedProvider | undefined;
    if (p && typeof p.connect === "function" && typeof p.signMessage === "function")
      return { name, provider: p };
  }
  return null;
}

export async function connectWallet(provider: InjectedProvider): Promise<string> {
  const result = await provider.connect();
  const key = (result && "publicKey" in result ? result.publicKey : null) ?? provider.publicKey;
  if (!key) throw new Error("The wallet did not share a public key.");
  return key.toString();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function signChallenge(provider: InjectedProvider, message: string): Promise<string> {
  const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  const bytes = signed instanceof Uint8Array ? signed : signed.signature;
  return toBase64(bytes);
}
