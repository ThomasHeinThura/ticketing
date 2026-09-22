import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import db from "../database";
import { instanceSettingTable } from "../database/schema";

/**
 * Issue #18 — the setup-token flow specified in
 * docs/01-architecture/auth-and-identity.md § Break-glass and
 * docs/01-architecture/security-model.md's secrets table ("Setup token | 32
 * bytes, printed once to the container log, one hour or one use").
 *
 * On an empty database, the ONLY legitimate way to create the first instance
 * administrator is to present this token (or, for headless installs, to sign
 * up as the exact address named by TASKDESK_BOOTSTRAP_ADMIN_EMAIL). Every
 * other zero-user signup is refused, regardless of DISABLE_REGISTRATION /
 * DISABLE_PASSWORD_REGISTRATION -- there is no other bypass.
 */

export const SETUP_TOKEN_HEADER = "x-taskdesk-setup-token";
export const SETUP_TOKEN_SINGLETON_ID = "singleton";
const SETUP_TOKEN_TTL_MS = 60 * 60 * 1000; // one hour, per security-model.md

function hashSetupToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * 32 raw bytes, URL-safe encoded so it can appear directly in the printed
 * setup URL's query string (auth-and-identity.md: "a one-time setup page ...
 * unlocked by a token").
 */
function generateRawSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * True once the instance has been claimed. A durable marker: it is never
 * cleared by deleting user rows, so it cannot be used to re-open the
 * zero-user bootstrap window after the fact.
 */
export async function isSetupCompleted(): Promise<boolean> {
  const [row] = await db
    .select({ setupCompletedAt: instanceSettingTable.setupCompletedAt })
    .from(instanceSettingTable)
    .limit(1);
  return row?.setupCompletedAt != null;
}

/**
 * Called once at server boot (runStartupTasks). While the instance is
 * unclaimed, every start generates a fresh token and invalidates whatever
 * token was printed before -- so an operator who lost the first one just
 * restarts the container (runbook.md's "First run" symptom row) rather than
 * needing a separate recovery path.
 *
 * A no-op once setup_completed_at is set: the `WHERE ... IS NULL` guard on
 * the upsert means a completed instance's row is never touched here, even if
 * this is called again (e.g. a future restart).
 *
 * Returns the raw token when one was (re)generated, or `null` when the
 * instance is already set up. The real entrypoint (runStartupTasks) only
 * cares about the side effect -- the raw value is also returned so tests can
 * exercise the actual generate-and-store path instead of reimplementing its
 * hashing to seed a row directly.
 */
export async function ensureSetupToken(): Promise<string | null> {
  if (await isSetupCompleted()) {
    return null;
  }

  const rawToken = generateRawSetupToken();
  const tokenHash = hashSetupToken(rawToken);
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);

  await db
    .insert(instanceSettingTable)
    .values({
      id: SETUP_TOKEN_SINGLETON_ID,
      setupTokenHash: tokenHash,
      setupTokenExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: instanceSettingTable.id,
      set: {
        setupTokenHash: tokenHash,
        setupTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      },
      // Defense in depth: even if isSetupCompleted() above raced with a
      // concurrent completion, never overwrite a completed instance's row.
      where: isNull(instanceSettingTable.setupCompletedAt),
    });

  const agentUrl = process.env.TASKDESK_AGENT_URL || "http://localhost:5173";
  const setupUrl = `${agentUrl.replace(/\/$/, "")}/auth/sign-up?setupToken=${rawToken}`;

  console.log("=".repeat(72));
  console.log("TaskDesk first-run setup");
  console.log(`Setup URL (valid for one hour or one use): ${setupUrl}`);
  console.log(`Setup token: ${rawToken}`);
  console.log(
    `Or send it as the ${SETUP_TOKEN_HEADER} header on the first sign-up request.`,
  );
  console.log("=".repeat(72));

  return rawToken;
}

/**
 * Atomically checks a candidate token and, if valid, invalidates it in the
 * same statement -- single use, enforced by the database rather than by a
 * read-then-write race in application code. Only one concurrent caller can
 * ever have this return true for a given token.
 */
export async function verifyAndConsumeSetupToken(
  candidate: string | null | undefined,
): Promise<boolean> {
  if (!candidate) {
    return false;
  }

  const candidateHash = hashSetupToken(candidate);

  const result = await db
    .update(instanceSettingTable)
    .set({ setupTokenHash: null, setupTokenExpiresAt: null })
    .where(
      and(
        eq(instanceSettingTable.setupTokenHash, candidateHash),
        gt(instanceSettingTable.setupTokenExpiresAt, new Date()),
      ),
    )
    .returning({ id: instanceSettingTable.id });

  return result.length > 0;
}

/**
 * The headless-install override (TASKDESK_BOOTSTRAP_ADMIN_EMAIL,
 * configuration-reference.md). Read fresh on every call rather than cached
 * at module load, so tests (and a real operator setting it after boot, then
 * restarting) see the current value. Ignored once the instance is claimed --
 * callers must check isSetupCompleted() themselves before relying on this.
 */
export function isBootstrapAdminEmail(email: unknown): boolean {
  const configured = process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL?.trim();
  if (!configured) {
    return false;
  }
  if (typeof email !== "string" || !email) {
    return false;
  }
  return email.trim().toLowerCase() === configured.toLowerCase();
}
