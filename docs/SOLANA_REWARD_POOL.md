# Solana Reward Pool

> Companion to [`KARMA_REWARDS.md`](./KARMA_REWARDS.md). Nothing here has been deployed, no wallet has been connected and no SOL has been sent.

## 1. The wallet

A **dedicated** Solana wallet is both the public Reward Pool and the fee-collection address.

- Its public address is `REWARD_POOL_WALLET_ADDRESS` (server environment; public by nature, shown on `/rewards` with a Solscan link).
- Its private key is **never** given to BetweenTasks. The server holds no signing key of any kind; it only reads the chain.
- Use the wallet for nothing else: every inbound transfer may be treated as fee income (see §3).
- The address is validated with `@solana/addresses` `isAddress`. It may be a multisig vault or other program-derived address; payout *recipient* wallets, by contrast, must be key-controlled (on-curve).

## 2. Balance

- `getBalance(address, { commitment: "finalized" })`, read by the scheduler (`/api/public/hooks/rewards-tick`) and by *Check RPC & refresh balance* in `/admin/rewards`.
- Cached in `reward_pool_state` (`pool_balance_lamports`, `balance_slot`, `balance_checked_at`). The public page reads the cache, never the RPC.
- Displayed in SOL (`lamports / 10⁹`, exact string formatting, no floats). No USD value is shown.

## 3. Fee indexing

Fee income is **never** inferred from the balance, because outgoing reward payments change it. Instead (`src/lib/rewards/fees.ts`):

1. `getSignaturesForAddress(pool, { commitment: "finalized", until: cursor, before, limit })`, newest first, page by page, stopping at the first epoch's start.
2. Processed **oldest first**. Failed transactions (`err ≠ null`) are skipped. Each transaction is fetched with `getTransaction(sig, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 })`.
3. Every System Program `transfer` / `transferWithSeed` — top-level (`"3"`) and inner/CPI (`"3.1"`) — whose destination is the pool and whose source is **not** the pool is recorded once in `reward_fee_transactions`, keyed by `(signature, transfer_index)`. Outgoing transfers and self-transfers are never recorded as income.
4. The cursor advances only over fully processed transactions. If a transaction is not yet visible at `finalized`, the run stops there and retries next time. A backlog larger than one run (10 pages × 500) is **not** processed and is reported as `backlog_exceeds_run`, so the cursor can never skip older transfers.
5. `indexer_synced_at` is set when a run caught up completely. A live epoch is calculated only once `indexer_synced_at ≥ epoch end`.

**Allowlist.** `reward_settings.fee_source_allowlist` (admin → Settings):

- **Empty (default): every inbound SOL transfer to the dedicated pool wallet is treated as fee income.** Keep the wallet dedicated.
- Non-empty: only transfers from listed addresses are `eligible`; others are stored as `ignored_not_allowlisted` for review and never count.
- An administrator can also exclude an individual transfer (for example a manual top-up) with a reason while its epoch is not finalized.

Only native SOL counts. SPL token transfers (including wSOL) are ignored.

**Network.** `SOLANA_NETWORK` (`mainnet-beta` in production). `SOLANA_RPC_URL` is a server-side HTTPS endpoint; it may include a provider key and is never logged, returned, or bundled — errors are reduced to fixed codes such as `rpc_timeout`, `rpc_http_429`, `rpc_error_-32005`.

## 4. RPC failure behaviour

- Any RPC error is recorded as `reward_pool_state.rpc_last_error` / `indexer_last_error` (code only) and shown in the admin panel.
- Karma accrual continues; the public page keeps the last good balance.
- Live epochs stay `open` with `fee_index_incomplete` until indexing catches up — no epoch is ever calculated on partial fee data.
- Payout confirmation simply waits; a submitted payout stays `submitted`.

## 5. Payout process (staged, no server key)

Browser-wallet transaction building was deliberately **not** implemented in this MVP: it would require a transaction library, careful fee/blockhash handling and chunking in the admin UI. Instead, the full calculation, review, export and on-chain reconciliation workflow is implemented, and the signing step is done by an administrator in their own wallet.

1. Epoch closes; the review delay passes; the scheduler calculates it (`review`, `live`).
2. Admin reviews allocations, flags, Karma events and fee transfers in `/admin/rewards` → Epochs; recalculates after any change.
3. Admin **approves** calculation version *N*. Allocations become final (`finalized_at`), including the snapshotted recipient address.
4. Admin **creates a payout batch**. The server builds a deterministic plan (sorted by recipient, then allocation id) with a SHA-256 checksum; the database function re-validates each item against its finalized allocation (same recipient, same lamports, still payable, no other live payout).
5. Admin **exports** the plan (JSON, CSV, and `solana transfer --url mainnet-beta --allow-unfunded-recipient <recipient> <SOL>` lines) and checks every recipient and amount.
6. Admin sends the transfers **from the Reward Pool wallet** in Phantom, Solflare, a hardware wallet or the Solana CLI. Several transfers may share one transaction.
7. Admin **submits the transaction signature** for the payouts it covers. The server fetches the transaction (`confirmed`); nothing is stored unless it contains, for each payout, a System transfer *pool → snapshotted recipient* of *exactly* the payout's lamports, executed after the batch was created, not already used by another payout. A value that is actually a private key is detected and refused.
8. The payout is `submitted`. The next reconciliation (every scheduler run, or *Reconcile now*) re-reads it at **`finalized`**; only then is it `confirmed`, the allocation `paid`, the batch `confirmed` and the epoch `paid`.
9. Every paid reward links to `https://solscan.io/tx/<signature>` (with `?cluster=` off mainnet).

**Retries and double-payment protection**

- One live payout per allocation (partial unique index) and one payout per on-chain transfer (unique `(tx_signature, transfer_index)`).
- A failed transaction (`meta.err`) returns the payout to `pending` automatically.
- A dropped transaction: *release* is allowed only ≥ 10 minutes after submission **and** when the transaction is absent at `confirmed` — so the original can no longer land.
- An unsent batch can be cancelled (epoch returns to `approved`); a batch with any submitted/confirmed payout cannot.
- Confirmed payouts and finalized allocations are immutable (database triggers).
- A wallet replaced after approval does not change the snapshotted recipient; a transfer to the new address does not settle the old payout.

**Transfers below rent exemption.** A new, unfunded recipient account needs at least ~0.00089 SOL; the default minimum payout (0.001 SOL) stays above that. Smaller amounts are carried forward.

## 6. Reconciliation procedure

1. `/admin/rewards` → Epochs → the paying epoch → Payouts: every payout should be `confirmed` with a signature; the epoch `paid`.
2. Compare the batch total with the sum of outgoing transfers on Solscan for the pool wallet in that period.
3. Pool balance check: `previous balance + indexed fee income − confirmed payouts − network fees ≈ current finalized balance`. Differences are usually manual top-ups (exclude them as fee income if they are not fees) or network fees.
4. Anything `submitted` for long: *Reconcile now*; if still not found after 10 minutes, *release* and pay again.
5. Everything is in the audit log (`reward_audit_events`): who approved, which signature was submitted for which payout, and when it was confirmed.

## 7. Remaining work for automated signing (not implemented)

- Build transfer transactions server-side (or in a shared validated module) from the stored plan, chunked to fit the transaction size limit.
- Simulate before submission; have the admin sign with `signAndSendTransaction` in Phantom.
- Keep the existing reconciliation path: submitted → finalized → confirmed. The database guarantees above stay unchanged.
