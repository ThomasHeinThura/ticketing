import { createHmac, hkdfSync } from "node:crypto";
import { credentialMatches, hashCredential } from "./logic";

const SUBKEY_PURPOSE = Buffer.from(
  "taskdesk:customer-invitation:credential:v1",
  "utf8",
);
const EMPTY_SALT = Buffer.alloc(0);
const SUBKEY_LENGTH = 32;

function masterKeyFromEnv(value: string | undefined): Buffer | null {
  const normalized = value?.trim();
  if (normalized === undefined || normalized === "") return null;
  if (!/^[a-f0-9]{64}$/iu.test(normalized)) {
    throw new Error("Configured encryption key is invalid");
  }
  return Buffer.from(normalized, "hex");
}

function derivePurposeSubKey(masterKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, EMPTY_SALT, SUBKEY_PURPOSE, SUBKEY_LENGTH),
  );
}

function validateDerivationInputs(invitationId: string, generation: number) {
  if (
    typeof invitationId !== "string" ||
    invitationId.length === 0 ||
    invitationId.length > 255 ||
    invitationId.includes(":")
  ) {
    throw new Error("Customer invitation id is invalid");
  }
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Customer invitation generation is invalid");
  }
}

function deriveWithMasterKey(
  masterKey: Buffer,
  invitationId: string,
  generation: number,
): string {
  validateDerivationInputs(invitationId, generation);
  const subKey = derivePurposeSubKey(masterKey);
  try {
    return createHmac("sha256", subKey)
      .update(`${invitationId}:${generation}`, "utf8")
      .digest("base64url");
  } finally {
    subKey.fill(0);
  }
}

/**
 * Derives the customer invitation accept credential (`HMAC-SHA256(subKey, id + ":" + generation)`)
 * using a dedicated HKDF-SHA256 sub-key derived from `TASKDESK_ENCRYPTION_KEY` (owner decision D-N,
 * contract CP-23). Only `hash` is persisted in `invitation.credential_hash`.
 */
export function deriveCustomerInvitationCredential(
  invitationId: string,
  generation: number,
): { credential: string; hash: string } {
  const masterKey = masterKeyFromEnv(process.env.TASKDESK_ENCRYPTION_KEY);
  if (!masterKey) throw new Error("TASKDESK_ENCRYPTION_KEY is required");
  try {
    const credential = deriveWithMasterKey(masterKey, invitationId, generation);
    return { credential, hash: hashCredential(credential) };
  } finally {
    masterKey.fill(0);
  }
}

/**
 * Reconstructs the active accept credential for an inviter copy action:
 * - For live rows (`storedHash !== null`), verifies against `storedHash` under the current key and
 *   falls back to `TASKDESK_ENCRYPTION_KEY_PREVIOUS` across a key rotation; returns `null` if
 *   neither matches (for instance a pre-0221 non-derivable row or a revoked/corrupted hash).
 * - For silent inert rows (`storedHash === null`, CP-22 anti-oracle), derives under the current key
 *   so copying cannot distinguish an uninvitable address from a deliverable one; acceptance still
 *   fails because `credentialMatches(null, ...)` is always false.
 */
export function resolveCustomerInvitationCredentialForCopy(input: {
  invitationId: string;
  generation: number;
  storedHash: string | null;
}): string | null {
  const currentKey = masterKeyFromEnv(process.env.TASKDESK_ENCRYPTION_KEY);
  if (!currentKey) throw new Error("TASKDESK_ENCRYPTION_KEY is required");
  const previousKey = masterKeyFromEnv(
    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS,
  );
  try {
    const currentCredential = deriveWithMasterKey(
      currentKey,
      input.invitationId,
      input.generation,
    );
    if (input.storedHash === null) {
      return currentCredential;
    }
    if (credentialMatches(input.storedHash, currentCredential)) {
      return currentCredential;
    }
    if (previousKey) {
      const previousCredential = deriveWithMasterKey(
        previousKey,
        input.invitationId,
        input.generation,
      );
      if (credentialMatches(input.storedHash, previousCredential)) {
        return previousCredential;
      }
    }
    return null;
  } finally {
    currentKey.fill(0);
    previousKey?.fill(0);
  }
}
