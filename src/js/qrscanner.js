// qrscanner.js — scan a recipient's address with the camera, and render a
// QR code of the user's own address for receiving.

import QRCode from "qrcode";

/** Camera scanning only works inside the native Android/iOS shell.
 * Dynamically importing the plugin means a plain-browser test run gets a
 * clear error message here instead of the whole app failing to load. */
export async function scanAddress() {
  let BarcodeScanner;
  try {
    ({ BarcodeScanner } = await import("@capacitor-community/barcode-scanner"));
  } catch (e) {
    throw new Error("QR scanning requires the native app — it isn't available in a browser.");
  }

  const perm = await BarcodeScanner.checkPermission({ force: true });
  if (!perm.granted) throw new Error("Camera permission is required to scan a QR code.");

  document.body.classList.add("scanner-active"); // style.css hides normal UI behind camera
  await BarcodeScanner.hideBackground();
  try {
    const result = await BarcodeScanner.startScan();
    if (result.hasContent) return result.content.trim();
    throw new Error("No QR code detected.");
  } finally {
    await BarcodeScanner.showBackground();
    await BarcodeScanner.stopScan();
    document.body.classList.remove("scanner-active");
  }
}

export async function renderAddressQr(canvasEl, address) {
  await QRCode.toCanvas(canvasEl, address, { margin: 1, width: 220 });
}
