// fiat-ramp.js — bank on/off-ramp via a THIRD PARTY'S hosted widget
// (MoonPay shown; Transak works the same way). MoonPay/Transak run their
// own public URL that collects the user's phone number, name, and KYC info
// on THEIR servers, not ours. We only ever open that URL with the wallet
// address pre-filled — we never see or store the user's bank details.
//
// This is the client-side widget flow, the only piece that can live
// entirely in a static app. A deeper inline integration needs a signed
// backend request and a business account with the provider.

import { loadConfig } from "./config.js";

async function openUrl(url) {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } catch (e) {
    // Outside the native shell (or if the plugin fails to load), fall back
    // to a normal new tab — still works fine for testing in a browser.
    window.open(url, "_blank", "noopener");
  }
}

export async function openBuyWidget(walletAddress) {
  const cfg = await loadConfig();
  const url = new URL(cfg.onRampWidgetBaseUrl);
  url.searchParams.set("apiKey", cfg.onRampApiKeyPlaceholder);
  url.searchParams.set("currencyCode", "sol");
  url.searchParams.set("walletAddress", walletAddress);
  await openUrl(url.toString());
}

/** Cash-out to bank: same pattern, MoonPay/Transak's "sell" widget. The
 * user completes bank linking and payout entirely on the provider's page. */
export async function openSellWidget(walletAddress) {
  const cfg = await loadConfig();
  const url = new URL(cfg.offRampWidgetBaseUrl);
  url.searchParams.set("apiKey", cfg.onRampApiKeyPlaceholder);
  url.searchParams.set("baseCurrencyCode", "sol");
  url.searchParams.set("refundWalletAddress", walletAddress);
  await openUrl(url.toString());
}
