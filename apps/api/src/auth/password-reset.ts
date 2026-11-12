import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNotNull, ne } from "drizzle-orm";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";

export type ResetPortal = "agent" | "customer";
export const RESET_IDENTIFIER_PREFIX = "reset-password-sha256:";

/** Only the digest is persisted; Better Auth calls this for both creation and consumption. */
export async function hashResetIdentifier(identifier: string): Promise<string> {
  return (
    RESET_IDENTIFIER_PREFIX +
    createHash("sha256").update(identifier).digest("hex")
  );
}

/** Bind a bearer to its issuing host without putting the auth secret in storage. */
export function signResetToken(
  token: string,
  portal: ResetPortal,
  secret: string,
) {
  const signature = createHmac("sha256", secret)
    .update("taskdesk-password-reset\0")
    .update(portal)
    .update("\0")
    .update(token)
    .digest("base64url");
  return `${token}.${signature}`;
}

export function verifyResetToken(
  signed: string,
  portal: ResetPortal,
  secret: string,
): string | null {
  const parts = signed.split(".");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1] ?? "")
  )
    return null;
  const expected = Buffer.from(signResetToken(parts[0], portal, secret));
  const supplied = Buffer.from(signed);
  return expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
    ? parts[0]
    : null;
}

export async function canResetPassword(
  userId: string,
  portal: ResetPortal,
  tx?: Transaction,
): Promise<boolean> {
  const executor = tx ?? db;
  const personQuery = executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, portal === "agent" ? "staff" : "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  const [person] = tx ? await personQuery.for("update") : await personQuery;
  if (!person) return false;
  const query = executor
    .select({ id: schema.accountTable.id })
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "credential"),
        isNotNull(schema.accountTable.password),
        ne(schema.accountTable.password, ""),
      ),
    )
    .limit(1);
  const [credential] = tx ? await query.for("update") : await query;
  return Boolean(credential);
}

export async function lockResetUser(
  token: string,
  portal: ResetPortal,
  tx: Transaction,
): Promise<string | null> {
  const [verification] = await tx
    .select({ value: schema.verificationTable.value })
    .from(schema.verificationTable)
    .where(
      and(
        eq(
          schema.verificationTable.identifier,
          await hashResetIdentifier(`reset-password:${token}`),
        ),
        gt(schema.verificationTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (
    !verification ||
    !(await canResetPassword(verification.value, portal, tx))
  )
    return null;
  return verification.value;
}

/** A separate keyed namespace in the existing anonymous ingress counter. */
export async function consumeResetAddressLimit(
  email: string,
  secret: string,
): Promise<boolean> {
  const { sql } = await import("drizzle-orm");
  const key = createHmac("sha256", secret)
    .update("password-reset-address\0")
    .update(email.trim().toLowerCase())
    .digest("hex");
  const table = schema.requestRateLimitCounterTable;
  const result = await db.execute(sql`
    INSERT INTO ${table} (bucket, key_hash, window_started_at, count, expires_at, created_at, updated_at)
    VALUES ('anonymous_invitation', ${key}, clock_timestamp(), 1, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp())
    ON CONFLICT (bucket, key_hash) DO UPDATE SET
      window_started_at = CASE WHEN ${table}.expires_at <= clock_timestamp() THEN clock_timestamp() ELSE ${table}.window_started_at END,
      count = CASE WHEN ${table}.expires_at <= clock_timestamp() THEN 1 ELSE LEAST(${table}.count + 1, 4) END,
      expires_at = CASE WHEN ${table}.expires_at <= clock_timestamp() THEN clock_timestamp() + interval '1 hour' ELSE ${table}.expires_at END,
      updated_at = clock_timestamp()
    RETURNING count
  `);
  return Number(result.rows[0]?.count ?? 4) <= 3;
}
