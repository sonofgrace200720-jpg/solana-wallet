// savings.js — a non-custodial "savings" balance.
//
// This app never holds user funds. The "savings account" is a SECOND
// Solana keypair, encrypted and stored on-device the same way as the main
// wallet. "Depositing" is an ordinary on-chain transfer from the main
// address to the vault address; "withdrawing" is the reverse. Nothing
// about this requires trusting a server, because there is no server in
// the transfer path.

import { Keypair } from "@solana/web3.js";
import { Preferences } from "@capacitor/preferences";
import { encryptSecret, decryptSecret } from "./crypto-utils.js";
import { sendTransferWithFee } from "./transfer.js";

const VAULT_STORAGE_KEY = "encrypted_vault_v1";
const VAULT_SALT_KEY = "vault_salt_v1";

export async function hasVault() {
  const { value } = await Preferences.get({ key: VAULT_STORAGE_KEY });
  return !!value;
}

/** Creates the vault keypair (first time the user opens Savings), encrypts
 * it with the given PIN, and returns its public key (base58). */
export async function createVault(pin) {
  const keypair = Keypair.generate();
  const { saltB64, blob } = await encryptSecret(keypair.secretKey, pin);
  await Preferences.set({ key: VAULT_SALT_KEY, value: saltB64 });
  await Preferences.set({ key: VAULT_STORAGE_KEY, value: blob });
  return keypair.publicKey.toBase58();
}

/** Unlocks the vault with a PIN and returns the vault Keypair. */
export async function unlockVault(pin) {
  const { value: saltB64 } = await Preferences.get({ key: VAULT_SALT_KEY });
  const { value: blobJson } = await Preferences.get({ key: VAULT_STORAGE_KEY });
  if (!saltB64 || !blobJson) throw new Error("No savings vault found on this device.");

  const decrypted = await decryptSecret(saltB64, blobJson, pin);
  return Keypair.fromSecretKey(decrypted);
}

/** Wipes the vault from this device. Irreversible. */
export async function eraseVault() {
  await Preferences.remove({ key: VAULT_STORAGE_KEY });
  await Preferences.remove({ key: VAULT_SALT_KEY });
}

/** Deposit: plain on-chain transfer from the unlocked main keypair to the
 * vault's public address. Goes through the same fee-splitting path as a
 * normal send — the fee applies to every transfer, per spec. */
export async function depositToSavings({ connection, mainKeypair, vaultPublicKeyB58, amountSol }) {
  return sendTransferWithFee({
    connection,
    senderKeypair: mainKeypair,
    recipientAddress: vaultPublicKeyB58,
    amountSol,
  });
}

/** Withdraw: the reverse transfer, signed with the vault's own keypair. */
export async function withdrawFromSavings({ connection, vaultKeypair, mainPublicKeyB58, amountSol }) {
  return sendTransferWithFee({
    connection,
    senderKeypair: vaultKeypair,
    recipientAddress: mainPublicKeyB58,
    amountSol,
  });
}
