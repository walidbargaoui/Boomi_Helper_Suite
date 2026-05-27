/**
 * Encryption-key rotation script for Boomi Helper Suite.
 *
 * Usage:
 *   tsx scripts/rotate-encryption-key.ts
 *
 * Reads every encrypted Boomi connection from SQLite, decrypts with the old key,
 * re-encrypts with a new 32-byte hex key, and writes the new key to .env.local.
 *
 * Requires the old key to be available in process.env.BOOMI_HELPER_ENCRYPTION_KEY.
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { decryptValue, encryptValue } from "../src/lib/boomi-crypto";

const prisma = new PrismaClient();

async function rotateKey() {
  const oldKey = process.env.BOOMI_HELPER_ENCRYPTION_KEY;
  if (!oldKey) {
    console.error("BOOMI_HELPER_ENCRYPTION_KEY is not set. Cannot rotate without the old key.");
    process.exit(1);
  }
  if (oldKey.length !== 64) {
    console.error("Old key must be 64 hex characters (32 bytes).");
    process.exit(1);
  }

  const newKey = randomBytes(32).toString("hex");
  const connections = await prisma.boomiConnection.findMany();

  if (connections.length === 0) {
    console.log("No connections to re-encrypt. Writing new key only.");
  } else {
    console.log(`Re-encrypting ${connections.length} connection(s)...`);
    for (const conn of connections) {
      let usernamePlain: string;
      let passwordPlain: string;
      try {
        usernamePlain = decryptValue(conn.apiUsername);
      } catch {
        console.warn(`  ⚠️  Failed to decrypt username for connection ${conn.id} — skipping.`);
        continue;
      }
      try {
        passwordPlain = decryptValue(conn.apiPassword);
      } catch {
        console.warn(`  ⚠️  Failed to decrypt password for connection ${conn.id} — skipping.`);
        continue;
      }

      // Temporarily swap the env key so encryptValue uses the new one
      process.env.BOOMI_HELPER_ENCRYPTION_KEY = newKey;
      const newUsername = encryptValue(usernamePlain);
      const newPassword = encryptValue(passwordPlain);
      process.env.BOOMI_HELPER_ENCRYPTION_KEY = oldKey;

      await prisma.boomiConnection.update({
        where: { id: conn.id },
        data: { apiUsername: newUsername, apiPassword: newPassword },
      });
      console.log(`  ✅ ${conn.accountId}/${conn.environmentName}`);
    }
  }

  // Write new key to .env.local
  const envPath = ".env.local";
  let envContent = "";
  try {
    envContent = await readFile(envPath, "utf-8");
  } catch {
    // file may not exist
  }

  const keyLine = `BOOMI_HELPER_ENCRYPTION_KEY=${newKey}`;
  if (envContent.includes("BOOMI_HELPER_ENCRYPTION_KEY=")) {
    envContent = envContent.replace(
      /BOOMI_HELPER_ENCRYPTION_KEY=.*/,
      keyLine,
    );
  } else {
    envContent = envContent.trimEnd() + "\n" + keyLine + "\n";
  }
  await writeFile(envPath, envContent);
  console.log(`\nNew key written to ${envPath}`);
  console.log(`Previous key: ${oldKey.slice(0, 8)}…${oldKey.slice(-8)}`);
  console.log(`New key:      ${newKey.slice(0, 8)}…${newKey.slice(-8)}`);
}

rotateKey()
  .catch((err) => {
    console.error("Rotation failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
