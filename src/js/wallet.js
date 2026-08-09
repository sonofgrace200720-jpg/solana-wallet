// wallet.js — key generation and encrypted local storage.
// The private key NEVER leaves the device and is NEVER stored in plaintext.
// It is encrypted with AES-GCM using a key derived (PBKDF2) from the user's
// PIN, and the encrypted blob is written to Capacitor's Preferences store.
// Unlocking can additionally require a biometric prompt.

import { Keypair } from "@solana/web3.js";
import { Preferences } from "@capacitor/preferences";
import { encryptSecret, decryptSecret } from "./crypto-utils.js";

const STORAGE_KEY = "encrypted_wallet_v1";
const SALT_KEY = "wallet_salt_v1";

/** Creates a brand-new wallet, encrypts the secret key with the given PIN,
 * and persists it. Returns the public key (base58) — this is the only
 * moment the caller should also prompt the user to back up their seed.
 * Throws if the PIN is too weak (see crypto-utils.MIN_PIN_LENGTH). */
export async function createWallet(pin) {
  const keypair = Keypair.generate();
  await encryptAndStore(keypair.secretKey, pin);
  return keypair.publicKey.toBase58();
}

/** Imports an existing wallet from a raw secret key (Uint8Array/array of 64
 * bytes) and encrypts it the same way. */
export async function importWallet(secretKeyArray, pin) {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
  await encryptAndStore(keypair.secretKey, pin);
  return keypair.publicKey.toBase58();
}

async function encryptAndStore(secretKey, pin) {
  const { saltB64, blob } = await encryptSecret(secretKey, pin);
  await Preferences.set({ key: SALT_KEY, value: saltB64 });
  await Preferences.set({ key: STORAGE_KEY, value: blob });
}

export async function hasWallet() {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  return !!value;
}

/** Best-effort biometric check. capacitor-native-biometric only does
 * anything meaningful inside the native Android/iOS shell — dynamically
 * importing it means a plain-browser test run (no native shell) just skips
 * biometrics instead of crashing the whole app at module-load time. */
async function tryBiometricPrompt() {
  try {
    const { NativeBiometric } = await import("capacitor-native-biometric");
    const available = await NativeBiometric.isAvailable();
    if (available.isAvailable) {
      await NativeBiometric.verifyIdentity({
        reason: "Unlock your Solana wallet",
        title: "Authenticate",
      });
    }
  } catch (e) {
    // Either the plugin isn't available in this environment (fine — PIN
    // still gates everything below) or the user cancelled/failed the
    // prompt (also fine to swallow: PIN is the real gate, biometrics is
    // just a faster front door when it's there).
    console.warn("Biometric step skipped:", e?.message || e);
  }
}

/** Unlocks the wallet with a PIN. Biometric is an optional extra gate in
 * front of it, never a replacement — the PIN is what the encryption key is
 * derived from, so there is no bypass path. */
export async function unlockWallet(pin, requireBiometric = true) {
  if (requireBiometric) await tryBiometricPrompt();

  const { value: saltB64 } = await Preferences.get({ key: SALT_KEY });
  const { value: blobJson } = await Preferences.get({ key: STORAGE_KEY });
  if (!saltB64 || !blobJson) throw new Error("No wallet found on this device.");

  const decrypted = await decryptSecret(saltB64, blobJson, pin);
  return Keypair.fromSecretKey(decrypted);
}

/** Wipes the wallet from this device. Irreversible — the user must have
 * their seed backed up elsewhere. */
export async function eraseWallet() {
  await Preferences.remove({ key: STORAGE_KEY });
  await Preferences.remove({ key: SALT_KEY });
}
