import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/**
 * Issue #296, S2 (Opus 5.5 review of PR #308): `CREATE ROLE ... PASSWORD '<plaintext>'` puts
 * the plaintext password in the SQL text. On any failure — an owner without `CREATEROLE` is
 * the realistic, reproduced case for an external/BYO Postgres — that text reaches the API log
 * (`prepareDatabaseStartup`, `startServer`'s error handler) and the Postgres server log
 * (`STATEMENT: ...`, logged by default on error). Re-running `ALTER ROLE ... PASSWORD` every
 * boot (this function is idempotent by design) means even a server with `log_statement =
 * 'ddl'`/`'all'`, or pgaudit, would log the plaintext password on every successful boot too.
 *
 * Postgres accepts a pre-computed SCRAM-SHA-256 verifier in `PASSWORD` in place of a plaintext
 * string — the exact `SCRAM-SHA-256$<iterations>:<base64 salt>$<base64 StoredKey>:<base64
 * ServerKey>` format `scram_build_secret` produces server-side (`src/common/scram-common.c`,
 * `src/backend/libpq/crypt.c`). Sending that instead means the plaintext password never
 * appears in the SQL text at all, in either log, on success or failure.
 *
 * No SASLprep normalisation: every password this function is ever given comes from
 * `openssl rand -hex 32` (`scripts/deploy.sh`) or the equivalent in `deploy/.env.example` /
 * Helm's generated secrets — pure ASCII hex, which SASLprep leaves unchanged. A password
 * containing Unicode would need it; this codebase never generates one.
 */
const SCRAM_ITERATIONS = 4096;
const KEY_LENGTH_BYTES = 32; // SHA-256 digest size
const SALT_LENGTH_BYTES = 16; // Postgres's own default (RAND_BUF_SIZE-derived) salt length

export function computeScramSha256Verifier(
  password: string,
  iterations: number = SCRAM_ITERATIONS,
): string {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const saltedPassword = pbkdf2Sync(
    password,
    salt,
    iterations,
    KEY_LENGTH_BYTES,
    "sha256",
  );
  const clientKey = createHmac("sha256", saltedPassword)
    .update("Client Key")
    .digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword)
    .update("Server Key")
    .digest();

  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$` +
    `${storedKey.toString("base64")}:${serverKey.toString("base64")}`
  );
}
