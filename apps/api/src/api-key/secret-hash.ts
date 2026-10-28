import {
  argon2,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AK-2: an API key secret is stored as an Argon2id hash, never in the clear.
 *
 * Stored format (PHC string, so the parameters travel with the hash and can be raised later):
 * `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt b64url>$<tag b64url>`.
 *
 * Keys issued before this change are an unsalted SHA-256 digest (43 base64url characters, no
 * `$`). They keep verifying and are rewritten to Argon2id on first use (`needsRehash`).
 *
 * Node's built-in `crypto.argon2` is used, so there is no new dependency. A key secret is 256
 * random bits, so the cost parameters protect against an offline attack on a leaked table
 * rather than against guessing; they follow the OWASP minimum (19 MiB, 2 passes, 1 lane).
 */
export const ARGON2ID_PARAMS = {
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
} as const;

const ARGON2_VERSION = 19;
const SALT_BYTES = 16;
const PREFIX = "$argon2id$";

/** The visible, non-secret prefix kept in `apikey.start`; also the lookup selector. */
export const API_KEY_SELECTOR_LENGTH = 12;

export function apiKeySelector(secret: string): string {
  return secret.slice(0, API_KEY_SELECTOR_LENGTH);
}

function argon2Async(
  message: string,
  nonce: Buffer,
  params: { memory: number; passes: number; parallelism: number },
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(message, "utf8"),
        nonce,
        parallelism: params.parallelism,
        tagLength,
        memory: params.memory,
        passes: params.passes,
      },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

/** Legacy digest (SHA-256, unpadded base64url): also what the old lookup column held. */
export function legacySha256ApiKeyHash(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export function isArgon2idHash(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export async function hashApiKeySecretArgon2id(
  secret: string,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await argon2Async(
    secret,
    salt,
    ARGON2ID_PARAMS,
    ARGON2ID_PARAMS.tagLength,
  );
  return `${PREFIX}v=${ARGON2_VERSION}$m=${ARGON2ID_PARAMS.memory},t=${ARGON2ID_PARAMS.passes},p=${ARGON2ID_PARAMS.parallelism}$${salt.toString("base64url")}$${tag.toString("base64url")}`;
}

type ParsedHash = {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
};

export function parseArgon2idHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  // ["", "argon2id", "v=19", "m=..,t=..,p=..", salt, tag]
  if (parts.length !== 6 || parts[1] !== "argon2id") return null;
  if (parts[2] !== `v=${ARGON2_VERSION}`) return null;
  const match = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? "");
  if (!match) return null;
  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  // Bound what a stored string can make the server compute.
  if (
    memory < 8 * parallelism ||
    memory > 262_144 ||
    passes < 1 ||
    passes > 10 ||
    parallelism < 1 ||
    parallelism > 8
  )
    return null;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const tag = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length < 8 || tag.length < 16 || tag.length > 64) return null;
  return { memory, passes, parallelism, salt, tag };
}

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SecretVerification = { valid: boolean; needsRehash: boolean };

/**
 * Constant-time check of a presented secret against a stored value of either format.
 * `needsRehash` is true for a legacy SHA-256 value and for an Argon2id value whose parameters
 * differ from the current ones.
 */
export async function verifyApiKeySecret(
  secret: string,
  stored: string,
): Promise<SecretVerification> {
  if (!isArgon2idHash(stored)) {
    const legacy = Buffer.from(legacySha256ApiKeyHash(secret));
    return {
      valid: sameBytes(legacy, Buffer.from(stored)),
      needsRehash: true,
    };
  }
  const parsed = parseArgon2idHash(stored);
  if (!parsed) return { valid: false, needsRehash: false };
  const tag = await argon2Async(secret, parsed.salt, parsed, parsed.tag.length);
  const valid = sameBytes(tag, parsed.tag);
  return {
    valid,
    needsRehash:
      valid &&
      (parsed.memory !== ARGON2ID_PARAMS.memory ||
        parsed.passes !== ARGON2ID_PARAMS.passes ||
        parsed.parallelism !== ARGON2ID_PARAMS.parallelism ||
        parsed.tag.length !== ARGON2ID_PARAMS.tagLength),
  };
}

/**
 * Remembers "this exact secret matched this exact stored hash" so a busy key does not pay an
 * Argon2id run per request. The cache holds an HMAC of the secret under a per-process random
 * key (never the secret) and the stored hash it matched; the row is still loaded on every
 * request, so revocation, expiry and a rewritten hash take effect immediately (AK-6).
 */
export class VerifiedSecretCache {
  private readonly key = randomBytes(32);
  private readonly entries = new Map<
    string,
    { stored: string; until: number }
  >();

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxEntries = 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  private slot(secret: string): string {
    return createHmac("sha256", this.key).update(secret).digest("base64url");
  }

  has(secret: string, stored: string): boolean {
    const slot = this.slot(secret);
    const hit = this.entries.get(slot);
    if (!hit) return false;
    if (hit.until <= this.now()) {
      this.entries.delete(slot);
      return false;
    }
    return hit.stored === stored;
  }

  remember(secret: string, stored: string): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(this.slot(secret), {
      stored,
      until: this.now() + this.ttlMs,
    });
  }
}
