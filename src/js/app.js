// app.js — entry point, loaded by index.html as the single <script
// type="module">. Import order in this file matters: polyfills.js must
// stay first (see its own comment) so window.Buffer exists before any
// module below it imports @solana/web3.js.
import "./polyfills.js";

import { getConnection } from "./config.js";
import { hasWallet, createWallet, unlockWallet } from "./wallet.js";
import { hasVault, createVault, unlockVault, depositToSavings, withdrawFromSavings } from "./savings.js";
import { sendTransferWithFee } from "./transfer.js";
import { recordReceipt, generateReceiptPdf } from "./receipt.js";
import { scanAddress, renderAddressQr } from "./qrscanner.js";
import { openBuyWidget, openSellWidget } from "./fiat-ramp.js";
import { initTheme, toggleTheme } from "./theme.js";
import { MIN_PIN_LENGTH } from "./crypto-utils.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

initTheme();
document.getElementById("themeToggle").onclick = () => toggleTheme();

let connection, unlockedKeypair;
let lastScannedAddress = null;

/** Prompts for a new PIN, requiring a matching confirmation and a minimum
 * length. Returns null if the user cancels at any point. */
function promptNewPin(label = "Create a PIN") {
  while (true) {
    const pin = prompt(`${label} (at least ${MIN_PIN_LENGTH} characters — cannot be recovered if forgotten):`);
    if (pin === null) return null;
    if (pin.length < MIN_PIN_LENGTH) {
      alert(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
      continue;
    }
    const confirmPin = prompt("Confirm your PIN:");
    if (confirmPin === null) return null;
    if (confirmPin !== pin) {
      alert("PINs didn't match — let's try again.");
      continue;
    }
    return pin;
  }
}

async function boot() {
  try {
    connection = await getConnection();
  } catch (e) {
    alert("Couldn't connect to the Solana network: " + e.message + "\n\nCheck config.json, then reload.");
    return;
  }

  if (!(await hasWallet())) {
    const pin = promptNewPin("Create a PIN to secure your new wallet");
    if (!pin) return;
    await createWallet(pin);
    alert("Wallet created. Back up your recovery phrase before storing real funds.");
  }

  const pin = prompt("Enter your PIN to unlock:");
  if (!pin) return;
  try {
    unlockedKeypair = await unlockWallet(pin, true);
  } catch (e) {
    alert(e.message);
    return;
  }

  await refreshBalance();
  await refreshSavingsBalance();
}

async function refreshBalance() {
  if (!unlockedKeypair) return;
  try {
    const lamports = await connection.getBalance(unlockedKeypair.publicKey);
    document.getElementById("balanceAmount").textContent = (lamports / LAMPORTS_PER_SOL).toFixed(4) + " SOL";
  } catch (e) {
    console.warn("Balance refresh failed:", e);
  }
}

async function refreshSavingsBalance() {
  const el = document.getElementById("savingsBalance");
  if (!(await hasVault())) {
    el.textContent = "No vault yet — tap Deposit to create one";
    return;
  }
  el.textContent = "— SOL (unlock to view)";
}

document.getElementById("sendBtn").onclick = async () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  const recipient = prompt("Recipient address:", lastScannedAddress || "");
  const amount = parseFloat(prompt("Amount (SOL):"));
  if (!recipient || !amount || amount <= 0) return;

  try {
    const { signature, amountLamports, feeLamports } = await sendTransferWithFee({
      connection,
      senderKeypair: unlockedKeypair,
      recipientAddress: recipient,
      amountSol: amount,
    });

    await recordReceipt({
      signature,
      from: unlockedKeypair.publicKey.toBase58(),
      to: recipient,
      amountSol: amountLamports / LAMPORTS_PER_SOL,
      feeSol: feeLamports / LAMPORTS_PER_SOL,
      timestamp: Date.now(),
    });

    const pdfDataUri = await generateReceiptPdf(signature);
    const link = document.createElement("a");
    link.href = pdfDataUri;
    link.download = `receipt-${signature.slice(0, 8)}.pdf`;
    link.click();

    alert("Transfer confirmed on-chain. Receipt downloaded.");
    lastScannedAddress = null;
    await refreshBalance();
  } catch (e) {
    alert("Transfer failed: " + e.message);
  }
};

document.getElementById("receiveBtn").onclick = async () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  const canvas = document.createElement("canvas");
  await renderAddressQr(canvas, unlockedKeypair.publicKey.toBase58());
  const w = window.open("", "_blank", "width=280,height=320");
  w.document.body.style.textAlign = "center";
  w.document.body.appendChild(canvas);
  const p = w.document.createElement("p");
  p.textContent = unlockedKeypair.publicKey.toBase58();
  w.document.body.appendChild(p);
};

document.getElementById("scanBtn").onclick = async () => {
  try {
    const address = await scanAddress();
    lastScannedAddress = address;
    alert("Scanned address:\n" + address + "\n\nIt'll be pre-filled next time you tap Send.");
  } catch (e) {
    alert(e.message);
  }
};

document.getElementById("depositBtn").onclick = async () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  try {
    let vaultPubkeyB58;
    if (!(await hasVault())) {
      if (!confirm("You don't have a savings vault yet. Create one now?")) return;
      const pin = promptNewPin("Create a PIN for your savings vault");
      if (!pin) return;
      vaultPubkeyB58 = await createVault(pin);
    } else {
      const pin = prompt("Enter your savings PIN to confirm the deposit destination:");
      if (!pin) return;
      const vaultKeypair = await unlockVault(pin);
      vaultPubkeyB58 = vaultKeypair.publicKey.toBase58();
    }

    const amount = parseFloat(prompt("Amount to move into savings (SOL):"));
    if (!amount || amount <= 0) return;

    const { signature, amountLamports, feeLamports } = await depositToSavings({
      connection,
      mainKeypair: unlockedKeypair,
      vaultPublicKeyB58: vaultPubkeyB58,
      amountSol: amount,
    });

    await recordReceipt({
      signature,
      from: unlockedKeypair.publicKey.toBase58(),
      to: vaultPubkeyB58,
      amountSol: amountLamports / LAMPORTS_PER_SOL,
      feeSol: feeLamports / LAMPORTS_PER_SOL,
      timestamp: Date.now(),
    });

    alert("Deposit confirmed on-chain.");
    await refreshBalance();
    await refreshSavingsBalance();
  } catch (e) {
    alert("Deposit failed: " + e.message);
  }
};

document.getElementById("withdrawBtn").onclick = async () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  if (!(await hasVault())) return alert("You don't have a savings vault yet — tap Deposit first.");

  try {
    const pin = prompt("Enter your savings PIN to unlock the vault:");
    if (!pin) return;
    const vaultKeypair = await unlockVault(pin);

    const amount = parseFloat(prompt("Amount to withdraw from savings (SOL):"));
    if (!amount || amount <= 0) return;

    const { signature, amountLamports, feeLamports } = await withdrawFromSavings({
      connection,
      vaultKeypair,
      mainPublicKeyB58: unlockedKeypair.publicKey.toBase58(),
      amountSol: amount,
    });

    await recordReceipt({
      signature,
      from: vaultKeypair.publicKey.toBase58(),
      to: unlockedKeypair.publicKey.toBase58(),
      amountSol: amountLamports / LAMPORTS_PER_SOL,
      feeSol: feeLamports / LAMPORTS_PER_SOL,
      timestamp: Date.now(),
    });

    alert("Withdrawal confirmed on-chain.");
    await refreshBalance();
    await refreshSavingsBalance();
  } catch (e) {
    alert("Withdrawal failed: " + e.message);
  }
};

document.getElementById("buyBtn").onclick = () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  openBuyWidget(unlockedKeypair.publicKey.toBase58());
};

document.getElementById("sellBtn").onclick = () => {
  if (!unlockedKeypair) return alert("Unlock your wallet first.");
  openSellWidget(unlockedKeypair.publicKey.toBase58());
};

boot();
