// config.js — loads config.json and provides a Connection that fails over
// to a backup RPC endpoint when the primary errors or rate-limits.
//
// config.json lives right next to this file's parent (src/config.json), so
// it always ships wherever src/ ships — including inside the Capacitor
// native app (webDir is "src") — with no build/copy step required.

import { Connection } from "@solana/web3.js";

let cachedConfig = null;

export async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch("./config.json");
  if (!res.ok) {
    throw new Error(`Couldn't load config.json (HTTP ${res.status}).`);
  }
  cachedConfig = await res.json();
  return cachedConfig;
}

/**
 * FailoverConnection wraps the primary RPC endpoint plus any
 * fallbackRpcEndpoints. Every call tries endpoints in order, moving to the
 * next one on a 429, 5xx, or network error, and gives up only once every
 * endpoint has failed.
 */
export class FailoverConnection {
  constructor(rpcEndpoint, fallbackRpcEndpoints = [], opts = { commitment: "confirmed" }) {
    this.endpoints = [rpcEndpoint, ...fallbackRpcEndpoints].filter(
      (e) => e && !e.startsWith("REPLACE_WITH")
    );
    if (this.endpoints.length === 0) {
      throw new Error("No usable RPC endpoints configured — edit config.json.");
    }
    this.opts = opts;
    this.connections = this.endpoints.map((e) => new Connection(e, opts));
    this.currentIndex = 0;
  }

  _rotate() {
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
  }

  async withFailover(fn) {
    let lastError;
    for (let attempt = 0; attempt < this.connections.length; attempt++) {
      const conn = this.connections[this.currentIndex];
      try {
        return await fn(conn);
      } catch (err) {
        lastError = err;
        const status = err?.status || err?.code;
        const message = String(err?.message || "");
        const retryable =
          status === 429 ||
          (typeof status === "number" && status >= 500) ||
          /429|rate.?limit|timeout|network|fetch failed/i.test(message);

        console.warn(
          `RPC endpoint ${this.endpoints[this.currentIndex]} failed` +
            (retryable ? " (retrying next endpoint)" : ""),
          err
        );
        this._rotate();
      }
    }
    throw new Error(`All RPC endpoints failed. Last error: ${lastError?.message || lastError}`);
  }

  getBalance(pubkey) {
    return this.withFailover((c) => c.getBalance(pubkey));
  }
  getLatestBlockhash() {
    return this.withFailover((c) => c.getLatestBlockhash());
  }
  sendRawTransaction(rawTx, opts) {
    return this.withFailover((c) => c.sendRawTransaction(rawTx, opts));
  }
  getSignatureStatus(signature, opts) {
    return this.withFailover((c) => c.getSignatureStatus(signature, opts));
  }
  confirmTransaction(strategy, commitment) {
    return this.withFailover((c) => c.confirmTransaction(strategy, commitment));
  }
}

export async function getConnection() {
  const cfg = await loadConfig();
  return new FailoverConnection(cfg.rpcEndpoint, cfg.fallbackRpcEndpoints || []);
}
