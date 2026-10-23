/**
 * `audit-purge` (`AU-3`, `AU-6`, `AU-13`, data-model.md §11; review-p0 F2/F4/F5/F18).
 *
 * Migrations 0131/0132 must be present (asserted, never skipped). The purge removes only the
 * oldest contiguous prefix past the 12-month floor enforced INSIDE `audit_log_purge_prefix`,
 * stops at the first held row, never deletes the head, writes an anchor derived by the function
 * itself plus its own `audit.purged` row, and `verifyAuditChain` still verifies from the anchor.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import { runAuditPurge } from "../../apps/api/src/audit/purge";
import { auditPurgePrerequisitesPresent } from "../../apps/api/src/audit/purge.repository";
import { verifyAuditChain } from "../../apps/api/src/audit/verify-audit-chain";
import db, { schema } from "../../apps/api/src/database";
import { appendBackdatedAudit } from "./helpers/audit-backdated";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const OLD = 400; // days: past the 12 month floor

async function append(organisationId: string | null = null) {
  return appendAuditLog(db, {
    actorId: `actor-${randomUUID()}`,
    actorType: "person",
    organisationId,
    action: "role.created",
    entityType: "role",
    entityId: randomUUID(),
    after: { n: 1 },
  });
}

async function auditCount() {
  const result = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM audit_log`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

describe("audit-purge", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("has the anchor table and the purge function migrated (0131/0132)", async () => {
    await expect(auditPurgePrerequisitesPresent(db)).resolves.toEqual({
      anchorTable: true,
      purgeFunction: true,
    });
  });

  it("purges the oldest prefix but keeps the head, anchors it, audits itself, and still verifies", async () => {
    await appendBackdatedAudit(OLD + 2);
    await appendBackdatedAudit(OLD + 1);
    await append();

    const outcome = await runAuditPurge();
    expect(outcome).toMatchObject({ status: "purged", purgedCount: 2 });

    const actions = await db.execute<{ action: string }>(
      sql`SELECT action FROM audit_log ORDER BY seq`,
    );
    expect(actions.rows.map((row) => row.action)).toEqual([
      "role.created",
      "audit.purged",
    ]);
    expect((await verifyAuditChain(db)).ok).toBe(true);

    // Idempotent: the remaining rows are inside retention.
    await expect(runAuditPurge()).resolves.toMatchObject({
      status: "nothing_to_purge",
    });
  });

  it("derives purged_through_at as max(created_at) when created_at is out of seq order", async () => {
    // seq order: 400d, 420d, 410d ago. The last-by-seq created_at (410d) is NOT the maximum.
    await appendBackdatedAudit(OLD);
    await appendBackdatedAudit(OLD + 20);
    await appendBackdatedAudit(OLD + 10);
    await append();

    const outcome = await runAuditPurge();
    expect(outcome).toMatchObject({ status: "purged", purgedCount: 3 });

    const anchor = await db.execute<{
      purged_count: number;
      through_iso: string;
      first_iso: string;
    }>(sql`
      SELECT purged_count,
        to_char(purged_through_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS through_iso,
        to_char(first_purged_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_iso
      FROM audit_chain_anchor
    `);
    expect(anchor.rows).toHaveLength(1);
    const row = anchor.rows[0];
    const throughMs = Date.parse(row?.through_iso ?? "");
    const firstMs = Date.parse(row?.first_iso ?? "");
    expect(Date.now() - throughMs).toBeGreaterThan((OLD - 1) * 86_400_000);
    expect(Date.now() - throughMs).toBeLessThan((OLD + 1) * 86_400_000);
    expect(Date.now() - firstMs).toBeGreaterThan((OLD + 19) * 86_400_000);
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("stops the prefix at the first row whose organisation is under an open hold", async () => {
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `audit-hold-${randomUUID()}`, name: "Held" })
        .returning(),
      "organisation",
    );
    await appendBackdatedAudit(OLD + 4);
    await appendBackdatedAudit(OLD + 3, { organisationId: organisation.id });
    await appendBackdatedAudit(OLD + 2);
    await appendBackdatedAudit(OLD + 1);
    await append();
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: organisation.id,
      placedBy: "integration-test",
      reason: "audit purge test",
    });

    const outcome = await runAuditPurge();
    expect(outcome).toMatchObject({ status: "purged", purgedCount: 1 });
    const held = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_log WHERE organisation_id = ${organisation.id}`,
    );
    expect(Number(held.rows[0]?.count)).toBe(1);
    expect((await verifyAuditChain(db)).ok).toBe(true);
  });

  it("does not purge rows inside retention", async () => {
    await append();
    await append();
    await expect(runAuditPurge()).resolves.toEqual({
      status: "nothing_to_purge",
      degraded: false,
    });
  });

  it("refuses, inside the database function, to purge rows inside the retention floor", async () => {
    // A caller that bypasses the job's retention planning (here: a shorter retention) is refused.
    await append();
    await append();
    await append();
    const before = await auditCount();
    await expect(runAuditPurge({ retention: "0 seconds" })).rejects.toThrow();
    expect(await auditCount()).toBe(before);
    const anchors = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_chain_anchor`,
    );
    expect(Number(anchors.rows[0]?.count)).toBe(0);
  });

  it("refuses a direct function call whose range contains one row inside the floor, even out of seq order", async () => {
    const oldRow = await appendBackdatedAudit(OLD);
    await append(); // recent row in the middle of the range
    await appendBackdatedAudit(OLD + 5);
    await append(); // head
    const before = await auditCount();
    await expect(
      db.execute(
        sql`SELECT * FROM audit_log_purge_prefix(${(oldRow.seq + 2n).toString()}::bigint)`,
      ),
    ).rejects.toThrow();
    expect(await auditCount()).toBe(before);
  });

  it("refuses to delete the chain head", async () => {
    const only = await appendBackdatedAudit(OLD);
    await expect(
      db.execute(
        sql`SELECT * FROM audit_log_purge_prefix(${only.seq.toString()}::bigint)`,
      ),
    ).rejects.toThrow();
    expect(await auditCount()).toBe(1);
  });
});
