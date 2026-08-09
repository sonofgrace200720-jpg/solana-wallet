// polyfills.js — MUST be the first import in app.js.
//
// @solana/web3.js (and libs it depends on, like borsh/bs58) assume a
// Node-like environment: a global `Buffer`, and sometimes `process.env`.
// Neither exists in a browser or a bare bundler build unless something
// provides it. Skipping this is the single most common reason a Solana
// web app throws "Buffer is not defined" (or silently fails) the moment
// it tries to build a transaction or generate a keypair.
//
// Import order matters here: ES modules evaluate a static import's whole
// subtree before continuing past it, so as long as this is app.js's FIRST
// import, `window.Buffer` is guaranteed to exist before wallet.js/
// transfer.js/config.js — which import @solana/web3.js — ever run.

import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
if (typeof globalThis.global === "undefined") {
  globalThis.global = globalThis;
}
if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: {}, browser: true, version: "" };
}
