/**
 * review-p0 F2/F4/F18: the application role cannot forge an anchor, cannot delete from
 * `audit_log`, and cannot purge rows inside the retention floor even through the one function
 * it may execute. Real Postgres, real role, real permission errors.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import { verifyAuditChain } from "../../apps/api/src/audit/verify-audit-chain";
import db from "../../apps/api/src/database";
import { ensureApplicationRole } from "../../apps/api/src/database/ensure-application-role";
import { appendBackdatedAudit } from "./helpers/audit-backdated";
import { resetTestDatabase } from "./helpers/database";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

describe("audit purge hardening -- application role", () => {
  const roleName = `taskdesk_app_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const rolePassword = randomBytes(32).toString("hex");
  let originalDatabaseUrl: string | undefined;
  let appClient: Client | undefined;
  let oldSeq: bigint;

  beforeAll(async () => {
    await resetTestDatabase();
    originalDatabaseUrl = process.env.TASKDESK_DATABASE_URL;
    if (!originalDatabaseUrl) {
      throw new Error("TASKDESK_DATABASE_URL must be set for this test");
    }
    const url = new URL(originalDatabaseUrl);
    url.username = roleName;
    url.password = rolePassword;
    process.env.TASKDESK_DATABASE_URL = url.toString();
    try {
      await ensureApplicationRole(db);
    } finally {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }
    appClient = new Client({ connectionString: url.toString() });
    await appClient.connect();

    // One row past the floor (so a purge would be legal on age alone) and a recent head.
    oldSeq = (await appendBackdatedAudit(500)).seq;
    await appendBackdatedAudit(499);
    await appendAuditLog(db, {
      actorId: "head",
      actorType: "system",
      action: "role.created",
      entityType: "role",
      entityId: randomUUID(),
    });
  });

  afterAll(async () => {
    await appClient?.end();
    await db.execute(sql.raw(`DROP OWNED BY ${quoteIdentifier(roleName)}`));
    await db.execute(
      sql.raw(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`),
    );
    if (originalDatabaseUrl) {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("can read audit_chain_anchor but holds no INSERT/UPDATE/DELETE on it", async () => {
    await expect(
      appClient?.query("SELECT count(*) FROM audit_chain_anchor"),
    ).resolves.toBeDefined();
    await expect(
      appClient?.query(`
        INSERT INTO audit_chain_anchor (id, purged_through_at, last_purged_row_hash, first_purged_created_at, purged_count)
        VALUES ('forged', 'infinity', '${"a".repeat(64)}', now(), 1)`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot delete from audit_log directly", async () => {
    await expect(appClient?.query("DELETE FROM audit_log")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("is refused when it calls the purge function with a range inside the retention floor", async () => {
    // The head is recent, so the range [oldSeq .. head-1] is fine age-wise; pick the range that
    // includes the head's predecessor only after adding a recent non-head row.
    await appendAuditLog(db, {
      actorId: "recent",
      actorType: "system",
      action: "role.created",
      entityType: "role",
      entityId: randomUUID(),
    });
    const head = await db.execute<{ seq: string }>(
      sql`SELECT max(seq)::text AS seq FROM audit_log`,
    );
    const through = (BigInt(head.rows[0]?.seq ?? "0") - 1n).toString(); // includes the recent "head" row
    await expect(
      appClient?.query("SELECT * FROM audit_log_purge_prefix($1::bigint)", [
        through,
      ]),
    ).rejects.toThrow(/retention floor/i);
    const count = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_log`,
    );
    expect(Number(count.rows[0]?.count)).toBe(4);
  });

  it("can purge a legitimately old prefix through the function, which writes the anchor itself", async () => {
    await expect(
      appClient?.query("SELECT * FROM audit_log_purge_prefix($1::bigint)", [
        (oldSeq + 1n).toString(),
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    const anchors = await db.execute<{ purged_count: number }>(
      sql`SELECT purged_count FROM audit_chain_anchor`,
    );
    expect(anchors.rows).toEqual([{ purged_count: 2 }]);
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });
});
