import bcrypt from "bcryptjs";
import {
  hashApiKeySecretArgon2id,
  isArgon2idHash,
  verifyApiKeySecret,
} from "../api-key/secret-hash";

// argon2id runs on the libuv pool via node:crypto, so a sign-in burst no longer blocks the event loop.
export const hashPassword = hashApiKeySecretArgon2id;

/** `needsRehash` is true only after a successful verify of a legacy bcrypt hash. */
export async function verifyPassword(
  hash: string,
  password: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (isArgon2idHash(hash)) return verifyApiKeySecret(password, hash);
  if (!hash.startsWith("$2")) return { valid: false, needsRehash: false };
  const valid = await bcrypt.compare(password, hash);
  return { valid, needsRehash: valid };
}
