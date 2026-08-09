// crypto-utils.js — shared PBKDF2/AES-GCM helpers used by wallet.js and
// savings.js, so both keypairs (main + vault) are encrypted with the exact
// same, single-audited code path instead of two copies drifting apart.

const PBKDF2_ITERATIONS = 200000;
export const MIN_PIN_LENGTH = 6;

export function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Throws if the PIN doesn't meet the minimum bar. */
export function assertPinStrength(pin) {
  if (typeof pin !== "string" || pin.length < MIN_PIN_LENGTH) {
    throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
  }
}

async function deriveKey(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypts `secretKey` with a key derived from `pin`. Returns the blob
 * ready to hand to Preferences.set (caller supplies the storage keys). */
export async function encryptSecret(secretKey, pin) {
  assertPinStrength(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, secretKey);
  return {
    saltB64: bufToB64(salt),
    blob: JSON.stringify({ iv: bufToB64(iv), data: bufToB64(ciphertext) }),
  };
}

/** Decrypts a blob produced by encryptSecret. Throws "Incorrect PIN." on
 * any failure — AES-GCM auth failure is indistinguishable from a wrong
 * key from the caller's point of view, which is the right thing to show. */
export async function decryptSecret(saltB64, blobJson, pin) {
  const { iv, data } = JSON.parse(blobJson);
  const key = await deriveKey(pin, b64ToBuf(saltB64));
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(iv) }, key, b64ToBuf(data))
    );
  } catch (e) {
    throw new Error("Incorrect PIN.");
  }
}
