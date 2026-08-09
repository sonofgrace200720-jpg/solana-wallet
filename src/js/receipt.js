// receipt.js — generates a receipt ONLY for a transaction signature that
// has been confirmed on-chain (see transfer.js's waitForConfirmation). Each
// signature can only ever have one receipt: the record is written once,
// keyed by signature, and hash-locked so it can't be silently rewritten.

import { Preferences } from "@capacitor/preferences";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { loadConfig } from "./config.js";

const RECEIPT_PREFIX = "receipt_";

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Records a receipt for a CONFIRMED transaction. Throws if a receipt for
 * this signature already exists with different details. */
export async function recordReceipt({ signature, from, to, amountSol, feeSol, timestamp }) {
  const key = RECEIPT_PREFIX + signature;
  const existing = await Preferences.get({ key });

  const canonical = JSON.stringify({ signature, from, to, amountSol, feeSol, timestamp });
  const integrityHash = await sha256Hex(canonical);
  const record = { signature, from, to, amountSol, feeSol, timestamp, integrityHash };

  if (existing.value) {
    const prior = JSON.parse(existing.value);
    if (prior.integrityHash !== integrityHash) {
      throw new Error("A receipt for this transaction signature already exists with different details. Refusing to overwrite.");
    }
    return prior;
  }

  await Preferences.set({ key, value: JSON.stringify(record) });
  return record;
}

export async function getReceipt(signature) {
  const { value } = await Preferences.get({ key: RECEIPT_PREFIX + signature });
  return value ? JSON.parse(value) : null;
}

export async function verifyReceipt(signature) {
  const record = await getReceipt(signature);
  if (!record) return false;
  const { integrityHash, ...rest } = record;
  const recomputed = await sha256Hex(JSON.stringify(rest));
  return recomputed === integrityHash;
}

/** Renders a stored, verified receipt as a downloadable PDF (base64 data URL). */
export async function generateReceiptPdf(signature) {
  const record = await getReceipt(signature);
  if (!record) throw new Error("No receipt found for this signature.");
  const valid = await verifyReceipt(signature);
  if (!valid) throw new Error("Receipt failed integrity check — will not render a corrupted receipt.");

  const cfg = await loadConfig();
  const explorerUrl = `${cfg.explorerBaseUrl}/${record.signature}`;
  const qrDataUrl = await QRCode.toDataURL(explorerUrl, { margin: 1, width: 220 });

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(18);
  doc.text("Transaction Receipt", 40, 50);

  doc.setFontSize(11);
  const lines = [
    ["Status", "Confirmed on-chain"],
    ["Date", new Date(record.timestamp).toLocaleString()],
    ["From", record.from],
    ["To", record.to],
    ["Amount", `${record.amountSol} SOL`],
    ["Service fee", `${record.feeSol} SOL`],
    ["Signature", record.signature],
    ["Integrity hash", record.integrityHash],
  ];
  let y = 90;
  for (const [label, value] of lines) {
    doc.setFont(undefined, "bold");
    doc.text(`${label}:`, 40, y);
    doc.setFont(undefined, "normal");
    doc.text(String(value), 150, y, { maxWidth: 400 });
    y += 26;
  }

  doc.addImage(qrDataUrl, "PNG", 40, y + 10, 120, 120);
  doc.setFontSize(9);
  doc.text("Scan to verify this transaction on a public Solana explorer.", 40, y + 145);

  return doc.output("datauristring");
}
