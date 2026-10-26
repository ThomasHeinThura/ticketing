import { sql } from "drizzle-orm";
import { reencryptDeliveryEnvelope } from "../customer-invitation/delivery/envelope";
import { purgeExpiredCustomerInvitationEnvelopes } from "../customer-invitation/delivery/repository";
import db from "../database";
import {
  currentEncryptionKeyId,
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
  previousEncryptionKeyConfigured,
} from "../identity/client-secret";
import {
  readableWithoutPreviousKey,
  reencryptSecret,
  TEXT_SECRET_LEGACY_PREFIX,
  TEXT_SECRET_V2_PREFIX,
} from "../notification-preferences/secrets";

/**
 * `GM-12`..`GM-14`, `secrets-rekey` (`background-jobs.md`): re-encrypts every
 * `instance_plugin_config.secrets` and `identity_connection.client_secret` envelope from
 * `TASKDESK_ENCRYPTION_KEY_PREVIOUS` to the current key. The envelope itself carries its 8-byte
 * `key_id` (bytes 5..12 after the `TDK1` magic), so the key a row is under is read from the row
 * and no extra column is needed. The selection is "rows whose key id is not the current one",
 * which makes the job resumable by construction: an interrupted run leaves exactly the rows it
 * had not reached, and a rerun picks those up. Each row is replaced with a compare-and-swap on
 * the old bytes, so a concurrent secret edit is never overwritten.
 */
type Target = {
  table: "instance_plugin_config" | "identity_connection";
  column: "secrets" | "client_secret";
};

const TARGETS: readonly Target[] = [
  { table: "instance_plugin_config", column: "secrets" },
  { table: "identity_connection", column: "client_secret" },
];

/**
 * Text columns holding an `enc:v1:` / `enc:v2:` secret (webhook signing secrets, current and the
 * rotated-out previous one, and the per-user notification tokens). A v2 value is the base64url of
 * the same `TDK1` envelope, so its key id is the 16 base64url characters after `enc:v2:` that
 * encode the 12-byte `TDK1` + key id header.
 */
type TextTarget = {
  table: "webhook" | "user_notification_preference";
  column: string;
};

const TEXT_TARGETS: readonly TextTarget[] = [
  { table: "webhook", column: "secret" },
  { table: "webhook", column: "secret_previous" },
  { table: "user_notification_preference", column: "ntfy_token" },
  { table: "user_notification_preference", column: "gotify_token" },
  { table: "user_notification_preference", column: "webhook_secret" },
];

const BATCH_SIZE = 100;
function deliveryEnvelopeHeader(currentId: Buffer): string {
  return Buffer.concat([Buffer.from("TDK1", "ascii"), currentId]).toString(
    "base64url",
  );
}

async function countInvitationDeliveryEnvelopes(
  currentId: Buffer | null,
  expired = false,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM customer_invitation_delivery
     WHERE envelope IS NOT NULL
       AND ${expired ? sql`expires_at <= now()` : sql`expires_at > now()`}
       ${currentId && !expired ? sql`AND left(envelope, 16) <> ${deliveryEnvelopeHeader(currentId)}` : sql``}
  `);
  return Number((result.rows[0] as { n: number | string }).n);
}

async function rekeyInvitationDeliveryEnvelopes(
  currentId: Buffer,
  outcome: { rekeyed: number; failed: number; raced: number },
) {
  const currentHeader = deliveryEnvelopeHeader(currentId);
  const skipped = new Set<string>();
  while (true) {
    const skipClause =
      skipped.size === 0
        ? sql``
        : sql`AND NOT (id = ANY(${Array.from(skipped)}::text[]))`;
    const page = await db.execute(sql`
      SELECT id, invitation_id, credential_hash, envelope
        FROM customer_invitation_delivery
       WHERE envelope IS NOT NULL
         AND expires_at > now()
         AND left(envelope, 16) <> ${currentHeader}
         ${skipClause}
       ORDER BY id
       LIMIT ${BATCH_SIZE}
    `);
    const rows = page.rows as Array<{
      id: string;
      invitation_id: string;
      credential_hash: string;
      envelope: string;
    }>;
    if (rows.length === 0) return;
    for (const row of rows) {
      const live = await db.execute(sql`
        SELECT 1
          FROM customer_invitation_delivery
         WHERE id = ${row.id}
           AND envelope = ${row.envelope}
           AND invitation_id = ${row.invitation_id}
           AND credential_hash = ${row.credential_hash}
           AND expires_at > now()
      `);
      if (live.rows.length === 0) continue;
      let next: string;
      try {
        // Revalidate JSON/AAD bindings before re-encrypting; expired rows are never decrypted.
        next = reencryptDeliveryEnvelope({
          deliveryId: row.id,
          invitationId: row.invitation_id,
          credentialHash: row.credential_hash,
          envelope: row.envelope,
        });
      } catch {
        skipped.add(row.id);
        outcome.failed += 1;
        continue;
      }
      const updated = await db.execute(sql`
        UPDATE customer_invitation_delivery
           SET envelope = ${next}, updated_at = clock_timestamp()
         WHERE id = ${row.id}
           AND envelope = ${row.envelope}
           AND invitation_id = ${row.invitation_id}
           AND credential_hash = ${row.credential_hash}
           AND expires_at > now()
        RETURNING id
      `);
      if (updated.rows.length === 1) outcome.rekeyed += 1;
      else {
        outcome.raced += 1;
        skipped.add(row.id);
      }
    }
  }
}

/** `enc:v2:` + base64url(`TDK1` + key id): the header every v2 value under `keyId` starts with. */
function textSecretHeader(currentId: Buffer): string {
  return `${TEXT_SECRET_V2_PREFIX}${Buffer.concat([Buffer.from("TDK1", "ascii"), currentId]).toString("base64url")}`;
}

function textPendingSql(target: TextTarget, currentId: Buffer | null) {
  const col = sql.raw(`"${target.column}"`);
  const encrypted = sql`(left(${col}, ${TEXT_SECRET_V2_PREFIX.length}) = ${TEXT_SECRET_V2_PREFIX} OR left(${col}, ${TEXT_SECRET_LEGACY_PREFIX.length}) = ${TEXT_SECRET_LEGACY_PREFIX})`;
  if (currentId === null) return encrypted;
  const header = textSecretHeader(currentId);
  // `left()` and `=` rather than LIKE: `_` is a valid base64url character and a LIKE wildcard.
  return sql`${encrypted} AND left(${col}, ${header.length}) <> ${header}`;
}

/** Every stored `enc:` value in the column, for the total. */
async function countText(target: TextTarget, mode: "all" | "needsPreviousKey") {
  const col = sql.raw(`"${target.column}"`);
  const table = sql.raw(`"${target.table}"`);
  if (mode === "all") {
    const result = await db.execute(
      sql`SELECT count(*)::int AS n FROM ${table} WHERE left(${col}, 4) = 'enc:'`,
    );
    return Number((result.rows[0] as { n: number | string }).n);
  }
  // "Needs the previous key": not under the current key id. A legacy v1 value that the current
  // key alone can read only awaits the format upgrade, so it must not make Health fail or stop
  // an operator removing the previous key. The set is small (webhooks and per-user tokens).
  const currentHex = currentEncryptionKeyId();
  const currentId = currentHex ? Buffer.from(currentHex, "hex") : null;
  const result = await db.execute(
    sql`SELECT ${col} AS value FROM ${table} WHERE ${textPendingSql(target, currentId)}`,
  );
  return (result.rows as Array<{ value: string }>).filter(
    (row) => !readableWithoutPreviousKey(row.value),
  ).length;
}

async function sumText(mode: "all" | "needsPreviousKey") {
  let n = 0;
  for (const target of TEXT_TARGETS) n += await countText(target, mode);
  return n;
}

/** The `key_id` bytes of an envelope: `TDK1` (4) then 8 bytes, so bytea positions 5..12. */
function keyIdSql(target: Target) {
  return sql.raw(`substring("${target.column}" from 5 for 8)`);
}

function tableSql(target: Target) {
  return sql.raw(`"${target.table}"`);
}
function columnSql(target: Target) {
  return sql.raw(`"${target.column}"`);
}

export type RekeyProgress = {
  /** Hex id of the key new envelopes are written under; null when none is configured. */
  currentKeyId: string | null;
  previousKeyConfigured: boolean;
  /** Expired invitation credentials still encrypted in rows awaiting the next cleanup pass. */
  expiredInvitationDeliveryEnvelopes: number;
  /** Rows holding a secret, per table. */
  total: {
    plugins: number;
    identityConnections: number;
    /** Webhook signing secrets and notification tokens. */
    textSecrets: number;
  };
  /** Rows whose envelope is not under the current key (still readable via the previous key). */
  pending: {
    plugins: number;
    identityConnections: number;
    textSecrets: number;
  };
  /** Every secret carries the current key id: the operator may remove the previous key. */
  complete: boolean;
};

async function count(target: Target, currentId: Buffer | null) {
  const where =
    currentId === null
      ? sql`${columnSql(target)} IS NOT NULL`
      : sql`${columnSql(target)} IS NOT NULL AND ${keyIdSql(target)} <> ${currentId}`;
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${tableSql(target)} WHERE ${where}`,
  );
  return Number((result.rows[0] as { n: number | string }).n);
}

async function countAll(target: Target) {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${tableSql(target)} WHERE ${columnSql(target)} IS NOT NULL`,
  );
  return Number((result.rows[0] as { n: number | string }).n);
}

/** `GM-14`: how far the rekey has got. Counts only; never any secret or envelope. */
export async function getSecretsRekeyProgress(): Promise<RekeyProgress> {
  const currentHex = currentEncryptionKeyId();
  const currentId = currentHex ? Buffer.from(currentHex, "hex") : null;
  const [
    plugins,
    identity,
    pluginsTotal,
    identityTotal,
    textPending,
    textTotal,
    deliveryPending,
    deliveryLiveTotal,
    deliveryExpired,
  ] = await Promise.all([
    count(TARGETS[0] as Target, currentId),
    count(TARGETS[1] as Target, currentId),
    countAll(TARGETS[0] as Target),
    countAll(TARGETS[1] as Target),
    sumText("needsPreviousKey"),
    sumText("all"),
    countInvitationDeliveryEnvelopes(currentId),
    countInvitationDeliveryEnvelopes(null),
    countInvitationDeliveryEnvelopes(null, true),
  ]);
  return {
    currentKeyId: currentHex,
    previousKeyConfigured: previousEncryptionKeyConfigured(),
    expiredInvitationDeliveryEnvelopes: deliveryExpired,
    total: {
      plugins: pluginsTotal,
      identityConnections: identityTotal,
      textSecrets: textTotal + deliveryLiveTotal + deliveryExpired,
    },
    pending: {
      plugins,
      identityConnections: identity,
      textSecrets: textPending + deliveryPending,
    },
    complete:
      currentHex !== null &&
      plugins === 0 &&
      identity === 0 &&
      textPending === 0 &&
      deliveryPending === 0 &&
      deliveryExpired === 0,
  };
}

export type RekeyOutcome = {
  rekeyed: {
    plugins: number;
    identityConnections: number;
    textSecrets: number;
  };
  /** Rows that could not be decrypted with either configured key (left untouched). */
  failed: {
    plugins: number;
    identityConnections: number;
    textSecrets: number;
  };
  /** Rows replaced concurrently while the job ran; the next run reconsiders them. */
  raced: number;
};

/** Re-encrypt `plaintextEnvelope` for `aad` under the current key. */
export function rekeyEnvelope(aad: string, envelope: Buffer): Buffer {
  return encryptIdentityClientSecret(
    aad,
    decryptIdentityClientSecret(aad, envelope),
  );
}

async function rekeyTarget(
  target: Target,
  currentId: Buffer,
  outcome: { rekeyed: number; failed: number; raced: number },
) {
  // Rows that fail to decrypt stay selected by the key-id predicate, so remember them for this
  // run instead of looping on them forever.
  const skipped = new Set<string>();
  while (true) {
    const page = await db.execute(sql`
      SELECT "id", ${columnSql(target)} AS envelope
        FROM ${tableSql(target)}
       WHERE ${columnSql(target)} IS NOT NULL
         AND ${keyIdSql(target)} <> ${currentId}
       ORDER BY "id"
       LIMIT ${BATCH_SIZE + skipped.size}
    `);
    const rows = (page.rows as Array<{ id: string; envelope: Buffer }>).filter(
      (row) => !skipped.has(row.id),
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      let next: Buffer;
      try {
        next = rekeyEnvelope(row.id, row.envelope);
      } catch {
        skipped.add(row.id);
        outcome.failed += 1;
        continue;
      }
      const updated = await db.execute(sql`
        UPDATE ${tableSql(target)}
           SET ${columnSql(target)} = ${next}
         WHERE "id" = ${row.id} AND ${columnSql(target)} = ${row.envelope}
        RETURNING "id"
      `);
      if (updated.rows.length === 1) outcome.rekeyed += 1;
      else {
        outcome.raced += 1;
        skipped.add(row.id);
      }
    }
  }
}

async function rekeyTextTarget(
  target: TextTarget,
  currentId: Buffer,
  outcome: { rekeyed: number; failed: number; raced: number },
) {
  const col = sql.raw(`"${target.column}"`);
  const table = sql.raw(`"${target.table}"`);
  const skipped = new Set<string>();
  while (true) {
    const page = await db.execute(sql`
      SELECT "id", ${col} AS value
        FROM ${table}
       WHERE ${textPendingSql(target, currentId)}
       ORDER BY "id"
       LIMIT ${BATCH_SIZE + skipped.size}
    `);
    const rows = (page.rows as Array<{ id: string; value: string }>).filter(
      (row) => !skipped.has(row.id),
    );
    if (rows.length === 0) return;
    for (const row of rows) {
      let next: string;
      try {
        next = reencryptSecret(row.value);
      } catch {
        skipped.add(row.id);
        outcome.failed += 1;
        continue;
      }
      const updated = await db.execute(sql`
        UPDATE ${table}
           SET ${col} = ${next}
         WHERE "id" = ${row.id} AND ${col} = ${row.value}
        RETURNING "id"
      `);
      if (updated.rows.length === 1) outcome.rekeyed += 1;
      else {
        outcome.raced += 1;
        skipped.add(row.id);
      }
    }
  }
}

/**
 * Runs the rekey to completion (or until the rows left are unreadable). Throws before touching
 * anything when no current key is configured, because there would be nothing to re-encrypt to.
 */
export async function runSecretsRekey(): Promise<RekeyOutcome> {
  const currentHex = currentEncryptionKeyId();
  if (!currentHex) throw new Error("TASKDESK_ENCRYPTION_KEY is required");
  const currentId = Buffer.from(currentHex, "hex");
  await purgeExpiredCustomerInvitationEnvelopes();
  const plugins = { rekeyed: 0, failed: 0, raced: 0 };
  const identity = { rekeyed: 0, failed: 0, raced: 0 };
  await rekeyTarget(TARGETS[0] as Target, currentId, plugins);
  await rekeyTarget(TARGETS[1] as Target, currentId, identity);
  const text = { rekeyed: 0, failed: 0, raced: 0 };
  for (const target of TEXT_TARGETS)
    await rekeyTextTarget(target, currentId, text);
  await rekeyInvitationDeliveryEnvelopes(currentId, text);
  return {
    rekeyed: {
      plugins: plugins.rekeyed,
      identityConnections: identity.rekeyed,
      textSecrets: text.rekeyed,
    },
    failed: {
      plugins: plugins.failed,
      identityConnections: identity.failed,
      textSecrets: text.failed,
    },
    raced: plugins.raced + identity.raced + text.raced,
  };
}
