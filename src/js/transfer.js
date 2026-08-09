// transfer.js — sends SOL to a recipient and the fee wallet in a single
// atomic transaction (two SystemProgram.transfer instructions). Either both
// transfers land or neither does — there's no way for the fee to be taken
// without the user's transfer succeeding, or vice versa.

import { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { loadConfig } from "./config.js";

export function calculateFeeLamports(amountSol, feePercentage) {
  const feeSol = (amountSol * feePercentage) / 100;
  return Math.round(feeSol * LAMPORTS_PER_SOL);
}

/**
 * Builds, signs, and sends a transfer. Waits for on-chain confirmation
 * before returning — only generate a receipt after this resolves.
 *
 * @returns {Promise<{signature: string, amountLamports: number, feeLamports: number}>}
 */
export async function sendTransferWithFee({ connection, senderKeypair, recipientAddress, amountSol }) {
  const cfg = await loadConfig();
  if (cfg.feeWalletAddress.startsWith("REPLACE_WITH")) {
    throw new Error("Fee wallet address is not configured in config.json.");
  }

  let recipientPubkey, feePubkey;
  try {
    recipientPubkey = new PublicKey(recipientAddress);
  } catch (e) {
    throw new Error("That doesn't look like a valid Solana address.");
  }
  feePubkey = new PublicKey(cfg.feeWalletAddress);

  const amountLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const feeLamports = calculateFeeLamports(amountSol, cfg.feePercentage);
  if (amountLamports <= 0) throw new Error("Amount must be greater than zero.");

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const tx = new Transaction({ feePayer: senderKeypair.publicKey, blockhash, lastValidBlockHeight });
  tx.add(
    SystemProgram.transfer({ fromPubkey: senderKeypair.publicKey, toPubkey: recipientPubkey, lamports: amountLamports })
  );
  if (feeLamports > 0) {
    tx.add(
      SystemProgram.transfer({ fromPubkey: senderKeypair.publicKey, toPubkey: feePubkey, lamports: feeLamports })
    );
  }

  tx.sign(senderKeypair);
  const raw = tx.serialize();

  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await waitForConfirmation(connection, signature);
  return { signature, amountLamports, feeLamports };
}

async function waitForConfirmation(connection, signature, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const info = status?.value;
    if (info) {
      if (info.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(info.err)}`);
      if (info.confirmationStatus === "confirmed" || info.confirmationStatus === "finalized") return true;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for confirmation. Check the signature on an explorer before assuming it failed.");
}
