// Solana JSON-RPC client over fetch. SERVER ONLY.
//
// The endpoint comes from SOLANA_RPC_URL, which may embed a provider API key.
// It is never logged, never returned to a caller and never sent to the browser:
// every failure is reduced to a short, fixed error code.

import type { ParsedTransaction, SignatureInfo, SolanaRpc } from "./fees";

export class RpcError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RpcError";
  }
}

const TIMEOUT_MS = 10_000;

export function createFetchRpc(url: string, fetchImpl: typeof fetch = fetch): SolanaRpc {
  let id = 0;
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: controller.signal,
      });
    } catch {
      throw new RpcError(controller.signal.aborted ? "rpc_timeout" : "rpc_unreachable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new RpcError(`rpc_http_${response.status}`);
    let body: { result?: T; error?: { code?: number } };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new RpcError("rpc_bad_response");
    }
    if (body.error)
      throw new RpcError(
        `rpc_error_${typeof body.error.code === "number" ? body.error.code : "unknown"}`,
      );
    return body.result as T;
  }

  return {
    async getHealth() {
      const result = await call<string>("getHealth", []);
      if (result !== "ok") throw new RpcError("rpc_unhealthy");
      return "ok";
    },
    async getBalance(address) {
      const result = await call<{ context: { slot: number }; value: number }>("getBalance", [
        address,
        { commitment: "finalized" },
      ]);
      if (typeof result?.value !== "number") throw new RpcError("rpc_bad_response");
      return { lamports: BigInt(result.value), slot: result.context.slot };
    },
    async getSignaturesForAddress(address, options) {
      const result = await call<SignatureInfo[]>("getSignaturesForAddress", [
        address,
        { commitment: "finalized", ...options },
      ]);
      if (!Array.isArray(result)) throw new RpcError("rpc_bad_response");
      return result;
    },
    async getTransaction(signature, commitment) {
      return call<ParsedTransaction | null>("getTransaction", [
        signature,
        { commitment, encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
    },
  };
}

export function rpcErrorCode(error: unknown): string {
  return error instanceof RpcError ? error.code : "rpc_failed";
}
