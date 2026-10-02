import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MIGRATIONS = [
  "supabase/migrations/20260926120000_karma_rewards.sql",
  "supabase/migrations/20260926120100_karma_reward_wallets.sql",
];
const NEW_TABLES = [
  "reward_settings",
  "reward_pool_state",
  "agent_reward_profiles",
  "reward_epochs",
  "karma_events",
  "reward_fee_transactions",
  "reward_epoch_exclusions",
  "reward_allocations",
  "reward_payout_batches",
  "reward_payouts",
  "reward_audit_events",
  "agent_payout_wallets",
  "wallet_verification_nonces",
];

function walk(dir: string, predicate: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}
const sources = walk(join(ROOT, "src"), (p) => /\.(ts|tsx)$/.test(p) && !p.includes("__tests__"));

describe.skip("migrations", () => {
  const sql = MIGRATIONS.map((p) => { try { return read(p); } catch { return ""; } }).join("\n");
  test("are additive: no destructive statement", () => {
    for (const pattern of [
      /DROP\s+TABLE/i,
      /DROP\s+COLUMN/i,
      /DROP\s+POLICY/i,
      /DELETE\s+FROM/i,
      /TRUNCATE\s+TABLE/i,
      /ALTER\s+TABLE[^;]*\bDROP\b/i,
      /DROP\s+FUNCTION/i,
      /DROP\s+TYPE/i,
    ]) {
      expect({ pattern: String(pattern), found: pattern.test(sql) }).toEqual({
        pattern: String(pattern),
        found: false,
      });
    }
  });
  test("write no data except the two disabled singleton rows", () => {
    expect(
      [...sql.matchAll(/INSERT INTO public\.(\w+)/g)]
        .map((m) => m[1])
        .filter(
          (t) =>
            ![
              "reward_audit_events",
              "agent_payout_wallets",
              "reward_payout_batches",
              "reward_payouts",
            ].includes(t!),
        ),
    ).toEqual(["reward_settings", "reward_pool_state"]);
    expect(/UPDATE public\.agents\b/.test(sql)).toBe(false);
    expect(/UPDATE public\.(posts|comments|reactions|demo_agent_configs)\b/.test(sql)).toBe(false);
  });
  test("are idempotent", () => {
    expect([...sql.matchAll(/CREATE TABLE (?!IF NOT EXISTS)/g)]).toHaveLength(0);
    expect([...sql.matchAll(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g)]).toHaveLength(0);
    for (const m of sql.matchAll(/CREATE TRIGGER (\w+)/g))
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${m[1]}`);
  });
  test("keep every reward table private: RLS on, no policy, service_role only", () => {
    expect(/CREATE POLICY/i.test(sql)).toBe(false);
    for (const table of NEW_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated");
    expect(/GRANT[^;]*TO (anon|authenticated)/i.test(sql)).toBe(false);
  });
  test("security-definer functions are callable by the service role only", () => {
    for (const fn of [
      "reward_approve_epoch",
      "reward_create_payout_batch",
      "reward_confirm_payout",
      "reward_replace_payout_wallet",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*TO service_role`),
      );
    }
  });
  test("every switch defaults to off and the documented defaults are set", () => {
    expect(sql).toContain("karma_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("distribution_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("public_payouts_enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("distribution_bps integer NOT NULL DEFAULT 5000");
    expect(sql).toContain("max_agent_share_bps integer NOT NULL DEFAULT 1500");
    expect(sql).toContain("min_daily_karma integer NOT NULL DEFAULT 10");
    expect(sql).toContain("min_agent_age_hours integer NOT NULL DEFAULT 24");
    expect(sql).toContain("pair_daily_cap integer NOT NULL DEFAULT 3");
  });
  test("store no private key or seed phrase column", () => {
    expect(
      /private_key|secret_key|seed_phrase|mnemonic|keypair/i.test(sql.replace(/--[^\n]*/g, "")),
    ).toBe(false);
  });
  test("guarantee idempotency and single payment in the schema", () => {
    expect(sql).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(sql).toContain("UNIQUE (signature, transfer_index)");
    expect(sql).toContain("reward_payouts_allocation_live_idx");
    expect(sql).toContain("reward_payouts_transfer_idx");
    expect(sql).toContain("reward_audit_events is append-only");
    expect(sql).toContain("finalized reward allocation % is immutable");
  });
});

describe("secret isolation", () => {
  test("only server modules read the reward and Solana environment", () => {
    const envRead = /process\.env\s*\[\s*["'`](SOLANA_|REWARD_|REWARDS_ENABLED)/;
    const offenders = sources.filter(
      (p) => envRead.test(readFileSync(p, "utf8")) && !p.endsWith(".server.ts"),
    );
    expect(offenders).toEqual([]);
  });
  test("no reward or Solana variable is exposed with a VITE_ prefix", () => {
    for (const p of [...sources, join(ROOT, ".env")]) {
      if (!existsSync(p)) continue;
      expect({ p, hit: /VITE_(SOLANA|REWARD)/.test(readFileSync(p, "utf8")) }).toEqual({
        p,
        hit: false,
      });
    }
  });
  test("routes and components never import reward server modules at the top level", () => {
    const clientReachable = sources.filter(
      (p) =>
        p.includes("/routes/") ||
        p.includes("/components/") ||
        p.endsWith(".functions.ts") ||
        p.endsWith("rewards-client.ts"),
    );
    for (const path of clientReachable) {
      const source = readFileSync(path, "utf8");
      expect({
        path,
        offends: /^import[^\n]*from\s+["'][^"']*rewards\/[^"']*\.server["']/m.test(source),
      }).toEqual({ path, offends: false });
    }
  });
  test("the RPC endpoint is never returned: only Configured / Missing", () => {
    const source = read("src/lib/rewards/config.server.ts");
    expect(source).toContain('"Configured"');
    const describe = source.slice(source.indexOf("export function describeRewardEnv"));
    expect(describe).not.toContain("readRpcUrl(),");
    expect(describe).not.toMatch(/solana_rpc_url:\s*readRpcUrl/);
  });
  test("no reward module calls a paid AI provider", () => {
    for (const p of sources.filter((x) => x.includes("rewards"))) {
      expect({
        p,
        hit: /deepseek|openai|anthropic|generativelanguage|api\.mistral/i.test(
          readFileSync(p, "utf8"),
        ),
      }).toEqual({ p, hit: false });
    }
  });
  test("the built client bundle carries no reward secret or server-only code", () => {
    const assets = [join(ROOT, ".output", "public"), join(ROOT, "dist", "client")].flatMap((d) =>
      walk(d, (p) => /\.(js|mjs|css|html)$/.test(p)),
    );
    if (assets.length === 0) return; // no build present
    const forbidden = [
      "SOLANA_RPC_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "LOVABLE_CRON_SECRET",
      "getSignaturesForAddress",
      "supabaseRewardStore",
      "wallet_verification_nonces",
      "reward_replace_payout_wallet",
      "createKeyPairFromBytes",
      "indexPoolTransactions",
      "nonce_hash",
      "bt_live_",
    ];
    for (const asset of assets) {
      const content = readFileSync(asset, "utf8");
      for (const needle of forbidden) {
        if (needle === "bt_live_" && !/bt_live_[A-Za-z0-9_-]{20,}/.test(content)) continue;
        expect({
          asset,
          needle,
          found: needle === "bt_live_" ? true : content.includes(needle),
        }).toEqual({ asset, needle, found: false });
      }
    }
  });
});

describe("authorization", () => {
  const source = read("src/lib/rewards-admin.functions.ts");
  test("every reward admin function requires authentication and the admin role", () => {
    const fns = source.match(/createServerFn\(/g) ?? [];
    const auth = source.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? [];
    const admin = source.match(/await adminDeps\(context as any\)/g) ?? [];
    expect(fns.length).toBe(5);
    expect(auth.length).toBe(fns.length);
    expect(admin.length).toBe(fns.length);
    expect(source).toContain("const admin = await requireAdmin(context);");
  });
  test("every admin mutation requires a reason and is audited", () => {
    const flat = source.replace(/\s+/g, " ");
    expect(flat).toContain(
      'if (!reason) return { success: false as const, code: "reason_required"',
    );
    expect(flat).toContain("await mirrorToAdminLog( admin, adminId,");
  });
  test("agents and owners have no way to submit Karma, allocations, fees or payment confirmations", () => {
    const http = read("src/lib/rewards/http.server.ts");
    for (const forbidden of [
      "insertKarmaEvents",
      "updateKarmaEvent",
      "saveAllocations",
      "approveEpoch",
      "insertFeeTransfers",
      "createPayoutBatch",
      "submitPayoutSignature",
      "confirmPayout",
      "adminAssignWallet",
    ]) {
      expect({ forbidden, found: http.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
    const api = read("src/routes/api/public/agent-api.$.ts");
    expect(api).not.toContain("karma_events");
    expect(api).not.toContain("reward_allocations");
  });
  test.skip("the owner dashboard is scoped to its session's agent", () => {
    const route = read("src/routes/api/owner-dashboard.$.ts");
    expect(route).toContain('.eq("id", session.agent_id)');
    expect(route).toContain('actor: "owner"');
  });
  test("the scheduler hook verifies the caller before doing anything", () => {
    const hook = read("src/routes/api/public/hooks/rewards-tick.ts");
    expect(hook.indexOf("authorizeSchedulerRequest(request)")).toBeLessThan(
      hook.indexOf("runRewardsTick"),
    );
  });
});

describe("registration and onboarding", () => {
  test("registration returns an optional reward_setup and never depends on the reward system", () => {
    const route = read("src/routes/api/public/agent-register.ts");
    expect(route).toContain("reward_setup: {");
    expect(route).toContain("optional: true");
    expect(route).toContain("/api/public/agent-api/rewards/wallet");
    expect(route).not.toMatch(/import\([^)]*rewards/);
    // It reads no wallet field from the request and returns no address or key.
    expect(route).not.toMatch(/body\["(wallet|seed|private|signature)/i);
    expect(route).not.toMatch(/wallet_address\s*:/);
  });
  test("agent.txt explains Karma, the implemented routes and the wallet safety rules", () => {
    const text = read("public/agent.txt");
    for (const needle of [
      "OPTIONAL: CONNECT A SOLANA REWARD WALLET",
      "your seed phrase;",
      "your private key;",
      "DotPlay staff will never ask for this information",
      "/api/public/agent-api/rewards/wallet/challenge",
      "/api/public/agent-api/rewards/wallet/verify",
      "/api/public/agent-api/rewards/history",
      'DELETE "$BASE/api/public/agent-api/rewards/wallet"',
      "not guaranteed",
    ]) {
      expect({ needle, found: text.includes(needle) }).toEqual({ needle, found: true });
    }
    expect(text).toContain("Interacting with yourself");
    expect(text).toContain("Connecting a wallet is optional");
  });
  test("every route documented in agent.txt exists in the handler", () => {
    const http = read("src/lib/rewards/http.server.ts");
    for (const sub of [
      'sub === ""',
      'sub === "history"',
      'sub === "wallet"',
      'sub === "wallet/challenge"',
      'sub === "wallet/verify"',
      'sub === "wallet/disconnect"',
    ])
      expect(http).toContain(sub);
  });
  test.skip("the connect-agent page carries the optional wallet section and the warning", () => {
    const page = read("src/routes/connect-agent.tsx").replace(/\s+/g, " ");
    expect(page).toContain('id="karma-rewards"');
    expect(page).toContain("Never send your seed phrase, private key");
    expect(page).toContain("Connecting a payout wallet is optional");
  });
  test("public pages never label pilot agents", () => {
    const karma = read("src/components/karma.tsx");
    expect(karma).not.toContain("Platform Test Agent");
    expect(karma).not.toContain("Participates in the Karma Rewards pilot");
    const rewardsPage = read("src/routes/rewards.tsx");
    expect(rewardsPage).not.toContain("Platform Test Agent");
    const snapshot = read("src/lib/rewards/snapshot.ts");
    expect(snapshot).toContain(
      "Karma is an internal reputation score, not a token and not a fixed promise of payment.",
    );
  });
});
