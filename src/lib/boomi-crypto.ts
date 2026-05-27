import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import fs from "fs";
import path from "path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // AES-GCM spec: NIST SP 800-38D requires 12-byte IV

export function generateKey(): string {
  return randomBytes(32).toString("hex");
}

// First-boot bootstrap: if no env key is set and we're not in production, generate
// a stable per-install key, persist it to .env.local, and load it into the current
// process so deriveKey() never falls back to a hardcoded value for *new* encryption.
//
// The .env.local file is appended only if it does not already declare the key — this
// avoids a "trail" of generated keys on every reload. Existing values in the file are
// detected by reading the file content.
function ensureBootstrapKey() {
  if (process.env.BOOMI_HELPER_ENCRYPTION_KEY) return;
  if (process.env.NODE_ENV === "production") return;

  const envFile = path.resolve(process.cwd(), ".env.local");
  let existing = "";
  try {
    existing = fs.readFileSync(envFile, "utf8");
  } catch {
    existing = "";
  }

  const match = existing.match(/^BOOMI_HELPER_ENCRYPTION_KEY\s*=\s*([0-9a-fA-F]{64})\s*$/m);
  if (match) {
    process.env.BOOMI_HELPER_ENCRYPTION_KEY = match[1];
    return;
  }

  const key = generateKey();
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(envFile, `${prefix}BOOMI_HELPER_ENCRYPTION_KEY=${key}\n`, { flag: "a" });
  process.env.BOOMI_HELPER_ENCRYPTION_KEY = key;
}

ensureBootstrapKey();

function deriveKey(): Buffer {
  const envKey = process.env.BOOMI_HELPER_ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length !== 64) {
      throw new Error("BOOMI_HELPER_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
    }
    return Buffer.from(envKey, "hex");
  }
  // We should only reach here in production with no key — fail loudly.
  if (process.env.NODE_ENV === "production") {
    throw new Error("BOOMI_HELPER_ENCRYPTION_KEY is required in production.");
  }
  // Last-resort fallback for non-Node test runners that import this module without
  // going through ensureBootstrapKey (e.g. some mocked-fs sandboxes). Kept as a hard
  // error path rather than a silent weakening — the bootstrap above is the supported path.
  throw new Error(
    "BOOMI_HELPER_ENCRYPTION_KEY is not set and bootstrap did not run. Set the env var before encrypting.",
  );
}

// Test-only helper: scrypt-derived deterministic key, NEVER used at runtime. Kept so
// existing tests that pre-seeded the dev DB with the old fallback key can still decrypt.
export function deriveLegacyDevKey(): Buffer {
  return scryptSync("boomi-helper-suite-local-encryption-v1", "local-dev", KEY_LENGTH);
}

export function encryptValue(plaintext: string): string {
  if (!plaintext) return "";
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");
  return `${iv.toString("base64")}:${authTag}:${encrypted}`;
}

export function decryptValue(ciphertext: string): string {
  if (!ciphertext) return "";
  const key = deriveKey();
  const [ivB64, authTagB64, encrypted] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encrypted) {
    throw new Error("Invalid encrypted value format.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"•".repeat(value.length - 4)}${value.slice(-2)}`;
}
