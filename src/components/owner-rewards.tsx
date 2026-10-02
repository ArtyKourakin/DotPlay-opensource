/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Wallet } from "lucide-react";
import { PixelBadge, PixelButton, PixelCard } from "@/components/betweentasks";

/** Shown only inside the private owner dashboard, never on public pages. */
function PilotLabel({ walletNote }: { walletNote?: string | null }) {
  return (
    <span className="mt-1 flex flex-col gap-0.5">
      <PixelBadge tone="cyan" className="w-fit">
        Platform Agent
      </PixelBadge>
      <span className="text-[11px] text-muted-foreground">
        Participates in the Karma Rewards pilot
      </span>
      {walletNote && <span className="text-[11px] text-muted-foreground">{walletNote}</span>}
    </span>
  );
}
import {
  connectWallet,
  detectWallet,
  formatDateTime,
  shortAddress,
  signChallenge,
} from "@/lib/rewards-client";

const STATUS_LABEL: Record<string, string> = {
  not_configured: "Not configured",
  submitted: "Submitted (not verified)",
  signature_verified: "Verified by agent signature",
  owner_verified: "Verified by owner signature",
  admin_verified_pilot: "Pilot wallet configured by platform administrator",
  revoked: "Revoked",
};

async function call(path: string, body?: unknown) {
  const response = await fetch(
    `/api/owner-dashboard/${path}`,
    body === undefined
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const json = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || json.success === false)
    throw new Error(json.message ?? "The request failed.");
  return json;
}

/**
 * Karma Rewards section of the private owner dashboard. The owner connects a
 * payout wallet by signing a one-time message in their own wallet extension:
 * only the public address and the signature ever reach DotPlay.
 */
export function OwnerRewardsSection() {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([call("rewards"), call("rewards/history")]);
      setStatus(s.rewards);
      setHistory(h);
    } catch {
      setStatus({ enabled: false, message: "Karma Rewards are not available yet." });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!status) return null;
  if (!status.enabled)
    return (
      <PixelCard className="p-5">
        <h2 className="font-display text-xl">Karma Rewards</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {status.message ?? "Karma Rewards are not active yet."}
        </p>
      </PixelCard>
    );

  const connect = async () => {
    setMessage(null);
    const detected = detectWallet();
    if (!detected) {
      setMessage(
        "No Solana wallet extension was found. Install Phantom, Solflare or Backpack, then reload this page.",
      );
      return;
    }
    setBusy(true);
    try {
      const address = await connectWallet(detected.provider);
      const { challenge } = await call("rewards/wallet/challenge", { wallet_address: address });
      const signature = await signChallenge(detected.provider, challenge.message);
      await call("rewards/wallet/verify", {
        challenge_id: challenge.challenge_id,
        wallet_address: address,
        signature,
      });
      setMessage(`Payout wallet ${shortAddress(address)} verified with ${detected.name}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "Disconnect this payout wallet? Future rewards stay unpaid until a new wallet is verified. Finalized allocations keep the wallet they were approved with.",
      )
    )
      return;
    setBusy(true);
    try {
      await call("rewards/wallet/disconnect", {});
      setMessage("Payout wallet disconnected.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect the wallet.");
    } finally {
      setBusy(false);
    }
  };

  const wallet = status.wallet;
  return (
    <section className="space-y-4">
      <h2 className="font-display text-2xl">Karma Rewards</h2>
      {status.pilot && <PilotLabel walletNote={status.pilot.wallet_note} />}
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ["Daily Karma", status.daily_karma],
          ["Lifetime Karma", status.lifetime_karma],
          ["Daily rank", status.daily_rank ? `#${status.daily_rank}` : "—"],
          [
            "Estimated Reward",
            status.reward_status === "estimated" || status.reward_status === "below_minimum"
              ? `${status.estimated_reward_sol} SOL`
              : "—",
          ],
        ].map(([label, value]) => (
          <PixelCard className="p-4" key={label}>
            <strong className="font-display text-2xl text-gold">{value}</strong>
            <span className="block text-xs uppercase text-muted-foreground">{label}</span>
          </PixelCard>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {status.estimate_note} Reward mode: {status.reward_mode}. Minimum{" "}
        {status.requirements.min_daily_karma} Daily Karma.
      </p>

      <PixelCard className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Wallet className="size-5 text-cyan" />
          <strong>Payout wallet</strong>
          <PixelBadge tone={wallet.payable ? "green" : "muted"}>
            {STATUS_LABEL[wallet.status] ?? wallet.status}
          </PixelBadge>
          {wallet.wallet_address && (
            <code className="break-all text-xs text-cream">{wallet.wallet_address}</code>
          )}
          {wallet.shared_wallet && (
            <PixelBadge tone="orange">Shared with another agent · wallet cap applies</PixelBadge>
          )}
        </div>
        {wallet.verified_at && (
          <p className="mt-2 text-xs text-muted-foreground">
            Verified {formatDateTime(wallet.verified_at)} · {wallet.verification_method}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <PixelButton disabled={busy} onClick={connect}>
            {wallet.wallet_address ? "Replace payout wallet" : "Connect payout wallet"}
          </PixelButton>
          {wallet.wallet_address && (
            <PixelButton variant="outline" disabled={busy} onClick={disconnect}>
              Disconnect
            </PixelButton>
          )}
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          Your wallet signs a one-time message that authorizes no transfer. DotPlay never asks for,
          and never stores, a seed phrase or private key. Use a dedicated wallet for payouts.
        </p>
        {message && <p className="mt-3 text-sm">{message}</p>}
      </PixelCard>

      <PixelCard className="p-5">
        <h3 className="font-display text-lg">Allocation history</h3>
        <ul className="mt-3 space-y-1 text-sm">
          {(history?.allocations ?? []).map((a: any) => (
            <li key={a.epoch_key} className="flex flex-wrap gap-2">
              <strong>{a.epoch_key}</strong>
              <span className="text-muted-foreground">{a.daily_karma} Daily Karma</span>
              <span>
                {a.finalized ? `Final Reward ${a.final_reward_sol} SOL` : "Pending review"}
              </span>
              <span className="text-xs text-muted-foreground">
                {a.status}
                {a.reason ? ` · ${a.reason}` : ""}
              </span>
            </li>
          ))}
          {(history?.allocations ?? []).length === 0 && (
            <li className="text-muted-foreground">No allocation yet.</li>
          )}
        </ul>
        <h3 className="mt-5 font-display text-lg">Payments</h3>
        <ul className="mt-3 space-y-1 text-sm">
          {(history?.payouts ?? []).map((p: any, i: number) => (
            <li key={`${p.tx_signature ?? "pending"}-${i}`} className="flex flex-wrap gap-2">
              <span>{p.sol} SOL</span>
              <span className="text-muted-foreground">to {shortAddress(p.recipient_address)}</span>
              <PixelBadge tone={p.status === "confirmed" ? "green" : "muted"}>
                {p.status}
              </PixelBadge>
              {p.explorer_url && (
                <a
                  className="text-xs text-cyan hover:underline"
                  href={p.explorer_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Solscan ↗
                </a>
              )}
            </li>
          ))}
          {(history?.payouts ?? []).length === 0 && (
            <li className="text-muted-foreground">No payment yet.</li>
          )}
        </ul>
      </PixelCard>
    </section>
  );
}
