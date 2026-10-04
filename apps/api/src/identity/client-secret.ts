import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const MAGIC = Buffer.from("TDK1", "ascii");
const KEY_ID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + KEY_ID_BYTES + IV_BYTES;

function keyFromEnvironment(
  name: "TASKDESK_ENCRYPTION_KEY" | "TASKDESK_ENCRYPTION_KEY_PREVIOUS",
) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return null;
  if (!/^[a-f0-9]{64}$/iu.test(value))
    throw new Error("Configured encryption key is invalid");
  return Buffer.from(value, "hex");
}

function keyId(key: Buffer): Buffer {
  return createHash("sha256").update(key).digest().subarray(0, KEY_ID_BYTES);
}

function additionalData(connectionId: string): Buffer {
  if (!connectionId || connectionId.length > 255)
    throw new Error("Identity connection id is invalid");
  return Buffer.from(connectionId, "utf8");
}

/** Encrypts an OIDC client secret with the existing per-row AES-256-GCM envelope. */
export function encryptIdentityClientSecret(
  connectionId: string,
  secret: string,
): Buffer {
  const key = keyFromEnvironment("TASKDESK_ENCRYPTION_KEY");
  if (!key) throw new Error("TASKDESK_ENCRYPTION_KEY is required");
  if (typeof secret !== "string")
    throw new Error("Identity client secret is invalid");
  const plaintext = Buffer.from(secret, "utf8");
  if (plaintext.length === 0 || plaintext.length > 16_384)
    throw new Error("Identity client secret is invalid");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData(connectionId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    MAGIC,
    keyId(key),
    iv,
    ciphertext,
    cipher.getAuthTag(),
  ]);
}

/** Decrypts only envelopes bound to this row and the current/previous configured key. */
export function decryptIdentityClientSecret(
  connectionId: string,
  envelope: Buffer,
): string {
  if (!Buffer.isBuffer(envelope) || envelope.length < HEADER_BYTES + TAG_BYTES)
    throw new Error("Identity client secret is unavailable");
  if (!timingSafeEqual(envelope.subarray(0, MAGIC.length), MAGIC))
    throw new Error("Identity client secret is unavailable");

  const encodedKeyId = envelope.subarray(
    MAGIC.length,
    MAGIC.length + KEY_ID_BYTES,
  );
  const current = keyFromEnvironment("TASKDESK_ENCRYPTION_KEY");
  const previous = keyFromEnvironment("TASKDESK_ENCRYPTION_KEY_PREVIOUS");
  const key = [current, previous].find(
    (candidate) =>
      candidate !== null && timingSafeEqual(keyId(candidate), encodedKeyId),
  );
  if (!key) throw new Error("Identity client secret is unavailable");

  const ivStart = MAGIC.length + KEY_ID_BYTES;
  const iv = envelope.subarray(ivStart, ivStart + IV_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  const ciphertext = envelope.subarray(
    ivStart + IV_BYTES,
    envelope.length - TAG_BYTES,
  );
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(additionalData(connectionId));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Identity client secret is unavailable");
  }
}
