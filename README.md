# Solana Wallet (non-custodial)

Self-custodial Solana wallet: the app generates and holds the user's
keypair on-device (encrypted), rather than connecting to an external wallet
like Phantom. That's a deliberate choice — see "Architecture note" below.

## Run it right now (no build step)
```
npx http-server src -p 8080 -c-1
```
Then open `http://localhost:8080`. That's it — dependencies load from a
CDN via an import map in `index.html`, so there's nothing to install or
bundle to see the UI working. (Opening `src/index.html` directly via
`file://` won't work — ES modules require an actual HTTP server, even a
local one.)

Camera scanning and biometric unlock are native-only and will show a
friendly "not available" message in a plain browser — that's expected, not
a bug. Everything else (create/unlock wallet, send, savings, receipts, fiat
on/off-ramp links, theme toggle) works fully in a browser for testing.

## Before you build the real Android app
1. Edit `src/config.json` (this is the actual file the app reads — it's
   already inside `webDir`, no copy step needed):
   - `feeWalletAddress` → your real Solana address that collects the 0.1% fee.
   - `fallbackRpcEndpoints` → add a dedicated RPC from Helius or QuickNode.
     The public default rate-limits hard under real usage.
   - `onRampApiKeyPlaceholder` → your MoonPay or Transak **publishable** key
     (never a secret key — this ships inside the app).
2. Replace `src/assets/icon-192.png` / `icon-512.png` — currently generated
   placeholders (purple circle + "S").
3. If you change RPC/fiat-ramp hosts, update the CSP `connect-src`/
   `frame-src` in `src/index.html` to match, or the WebView will silently
   block those requests.
4. `npm install`, `npx cap add android` (once), then `npm run sync` (runs
   `cap sync android`) to pull the native Capacitor plugins in.
5. `npm run build:android` builds a release APK locally, or push a `v*` tag
   to let CI do it (see below).

## Architecture note: why not Wallet Adapter / Mobile Wallet Adapter
`@solana/wallet-adapter-react` and Mobile Wallet Adapter connect your app
to an *already-installed* wallet (Phantom, Solflare, etc.) — that other app
holds the keys and approves each transaction; yours never touches them.
That's the right architecture for a dApp, but it's incompatible with what's
actually being built here: an app that itself generates a keypair, signs
transfers, and runs a "savings vault" (a second self-held keypair). You
can't have an in-app custody-and-signing flow AND delegate all signing to
an external wallet — so this build keeps the self-custodial model
throughout, matching the send/savings/PIN requirements.

## Why no TypeScript compile step
Same reasoning as the CDN-without-bundler choice above: adding `tsc`/
esbuild back in re-introduces "did you run the build" as a failure mode.
Files use `// @ts-check` + JSDoc types instead, which gives you type
checking in an editor (VS Code, etc.) without any compile step. If you
later add a bundler for a production build, converting to real `.ts` is a
mechanical step at that point — nothing here is written in a way that
fights it.

## How the fee actually works
Every send builds ONE transaction with TWO instructions: transfer to the
recipient, transfer 0.1% to your fee wallet. Both succeed or both fail —
there's no way for the fee to be taken without the user's transfer landing.

## What "savings" is here
No pooled account holding user funds — that would make this a custodial
financial product with real regulatory obligations (money transmitter/MSB
licensing in most jurisdictions). "Savings" is a second on-device keypair
(its own PIN, own encrypted storage), created the first time you tap
**Deposit**. Deposit/withdraw are ordinary transfers between the user's two
own addresses, through the same fee-splitting path as a normal send.

## What the bank/fiat part actually is
`fiat-ramp.js` opens MoonPay's or Transak's *hosted* checkout, with the
wallet address pre-filled. The user's phone number, name, KYC, and bank
linking happen entirely on the provider's page — this app never sees or
stores that data. A deeper inline integration (skipping the redirect)
needs a signed backend request and a business account with the provider,
which is out of scope for a static Capacitor app.

## Security model
- Private key: AES-GCM encrypted at rest, key derived via PBKDF2 from the
  user's PIN (200k iterations). Never stored or transmitted in plaintext.
- PINs are at least 6 characters and confirmed (typed twice) on creation,
  for both the main wallet and the savings vault.
- Biometric prompt is an additional gate in front of the PIN, never a
  replacement — the PIN is what the encryption key is derived from.
- RPC calls fail over to `fallbackRpcEndpoints` on 429/5xx/network errors.
- Receipts are only generated after `getSignatureStatus` confirms the
  transaction on-chain, and are hash-locked per signature.
- A `Content-Security-Policy` in `index.html` restricts the WebView to
  same-origin assets plus the specific CDN/RPC/fiat-ramp hosts in use.

## GitHub Actions
1. Run `sign-key.yml` once manually (needs a `TEMP_KEYSTORE_PASSWORD`
   secret set first). Download the artifact, add `KEYSTORE_BASE64`,
   `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` as permanent repo
   secrets, then delete that workflow run's artifact.
2. Push a tag like `v1.0.0` to trigger `build-and-release.yml`, which
   builds the signed APK, uploads it as a workflow artifact, and attaches
   it to a GitHub Release.

## Not included / needs your judgment
- Full UI polish — this ships functional modals as browser `prompt()`/
  `confirm()` calls; swap in real modal components for a production UI.
- For a fully offline-capable native build (no CDN dependency at runtime),
  add an esbuild bundle step before `cap sync` and point `index.html` at
  the bundle instead of the import map. The import-map approach here
  trades that offline guarantee for "it just runs, no build tooling
  required" — reasonable for getting something working now, worth
  revisiting before a real production release.
- Legal review: even the non-custodial version charging a transaction fee
  may have money-services implications depending on jurisdiction and
  volume. This isn't legal advice — check with someone qualified before
  launching.
