// CP-23 short-lived encrypted SMTP delivery queue. Root wires this table into the
// database schema export and migration registry.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { invitationTable } from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

export const customerInvitationDeliveryTable = pgTable(
  "customer_invitation_delivery",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    invitationId: text("invitation_id")
      .notNull()
      .references(() => invitationTable.id, { onDelete: "cascade" }),
    /** Hash snapshot binds this row to one accept-credential generation. */
    credentialHash: text("credential_hash"),
    /** Process boot UUID owning the only in-memory key for a recoverable envelope. */
    ownerId: uuid("owner_id"),
    resend: boolean("resend").notNull().default(false),
    /** Purpose-bound ciphertext; only the queued credential is in the payload. */
    envelope: text("envelope"),
    state: text("state")
      .$type<"queued" | "sending" | "sent" | "suppressed" | "failed">()
      .notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", tz).notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", tz),
    terminalCode: text("terminal_code"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    check(
      "customer_invitation_delivery_state_check",
      sql`${table.state} IN ('queued', 'sending', 'sent', 'suppressed', 'failed')`,
    ),
    check(
      "customer_invitation_delivery_attempts_check",
      sql`${table.attempts} BETWEEN 0 AND 3`,
    ),
    check(
      "customer_invitation_delivery_expiry_check",
      sql`${table.expiresAt} >= ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + INTERVAL '15 minutes'`,
    ),
    check(
      "customer_invitation_delivery_state_shape_check",
      sql`(
        (${table.state} = 'queued' AND ${table.envelope} IS NOT NULL AND ${table.credentialHash} IS NOT NULL AND ${table.ownerId} IS NOT NULL AND ${table.leaseId} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.terminalCode} IS NULL)
        OR (${table.state} = 'sending' AND ${table.envelope} IS NOT NULL AND ${table.credentialHash} IS NOT NULL AND ${table.ownerId} IS NOT NULL AND ${table.leaseId} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.terminalCode} IS NULL)
        OR (${table.state} = 'suppressed' AND ${table.envelope} IS NULL AND ${table.credentialHash} IS NULL AND ${table.ownerId} IS NULL AND ${table.leaseId} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.terminalCode} IN ('inert', 'expired', 'revoked', 'accepted', 'rejected', 'superseded'))
        OR (${table.state} = 'sent' AND ${table.envelope} IS NULL AND ${table.credentialHash} IS NULL AND ${table.ownerId} IS NULL AND ${table.leaseId} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.terminalCode} = 'sent')
        OR (${table.state} = 'failed' AND ${table.envelope} IS NULL AND ${table.credentialHash} IS NULL AND ${table.ownerId} IS NULL AND ${table.leaseId} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.terminalCode} IN ('provider_rejected', 'envelope_unavailable', 'retry_exhausted'))
      )`,
    ),
    check(
      "customer_invitation_delivery_terminal_code_check",
      sql`${table.terminalCode} IS NULL OR ${table.terminalCode} IN ('inert', 'sent', 'provider_rejected', 'envelope_unavailable', 'expired', 'revoked', 'accepted', 'rejected', 'superseded', 'retry_exhausted')`,
    ),
    uniqueIndex("customer_invitation_delivery_generation_unique")
      .on(table.invitationId, table.credentialHash)
      .where(sql`${table.credentialHash} IS NOT NULL`),
    index("customer_invitation_delivery_due_idx")
      .on(table.nextAttemptAt, table.expiresAt)
      .where(sql`${table.state} IN ('queued', 'sending')`),
    index("customer_invitation_delivery_invitation_idx").on(table.invitationId),
  ],
);
