/**
 * Issue #37, first slice: the `audit_log` table and its append-only, hash-chained
 * writer (`apps/api/src/audit/audit-writer.ts`, `verify-audit-chain.ts`). Real
 * PostgreSQL, not mocks -- every assertion here is either a DB-level constraint (the
 * append-only trigger) or the writer/verifier's own hashing and serialisation, and a
 * happy-path-only test would pass with either reverted.
 *
 * No route, no UI, nothing wired into a real mutation yet -- this suite exercises the
 * writer and verifier directly.
 */
import { randomUUID } from "node:crypto";
import { canonicalRowHash, type JsonValue, ZERO_HASH } from "@taskdesk/domain";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AppendAuditLogInput,
  appendAuditLog,
} from "../../apps/api/src/audit/audit-writer";
import { verifyAuditChain } from "../../apps/api/src/audit/verify-audit-chain";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

/** drizzle-orm wraps the real Postgres error in a `DrizzleQueryError` whose own
 * `.message` is just "Failed query: ..."; the actual driver error (with the trigger's
 * `RAISE EXCEPTION` text) is one level down, on `.cause`. */
function deepestMessage(error: unknown): string {
  let current: unknown = error;
  let message = "";
  while (current instanceof Error) {
    message = current.message;
    current = current.cause;
  }
  return message;
}

async function expectRejectionMatching(
  promise: Promise<unknown>,
  pattern: RegExp,
) {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(deepestMessage(thrown)).toMatch(pattern);
}

async function makeOrganisation() {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `audit-org-${randomUUID()}`,
        name: "Audit Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeOrganisation",
  );
}

function baseInput(
  overrides?: Partial<AppendAuditLogInput>,
): AppendAuditLogInput {
  return {
    actorId: `person-${randomUUID()}`,
    actorType: "person",
    action: "role.created",
    entityType: "role",
    entityId: `role-${randomUUID()}`,
    before: null,
    after: { name: "Editor" },
    ...overrides,
  };
}

async function readRawRow(id: string) {
  const result = await db.execute<{
    actor_id: string | null;
    actor_type: string;
    api_key_id: string | null;
    impersonator_id: string | null;
    actor_ip: string | null;
    user_agent: string | null;
    trace_id: string | null;
    workspace_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string;
    before: JsonValue | null;
    after: JsonValue | null;
    created_at_iso: string;
    prev_hash: string;
    row_hash: string;
    seq: string;
  }>(sql`
    SELECT
      actor_id, actor_type, api_key_id, impersonator_id, actor_ip, user_agent,
      trace_id, workspace_id, action, entity_type, entity_id, before, after,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
      prev_hash, row_hash, seq
    FROM audit_log WHERE id = ${id}
  `);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`readRawRow: no audit_log row with id ${id}`);
  }
  return row;
}

describe("appendAuditLog", () => {
  it("produces the row_hash canonicalRowHash independently computes over the stored row", async () => {
    const input = baseInput();
    const result = await appendAuditLog(db, input);
    const raw = await readRawRow(result.id);

    expect(raw.prev_hash).toBe(ZERO_HASH);

    const independentlyComputed = canonicalRowHash(
      {
        actorId: raw.actor_id,
        actorType: raw.actor_type,
        apiKeyId: raw.api_key_id,
        impersonatorId: raw.impersonator_id,
        actorIp: raw.actor_ip,
        userAgent: raw.user_agent,
        traceId: raw.trace_id,
        workspaceId: raw.workspace_id,
        action: raw.action,
        entityType: raw.entity_type,
        entityId: raw.entity_id,
        before: raw.before,
        after: raw.after,
        createdAt: raw.created_at_iso,
      },
      raw.prev_hash,
    );

    expect(raw.row_hash).toBe(independentlyComputed);
    expect(result.rowHash).toBe(independentlyComputed);
  });

  it("chains three rows: each prev_hash equals the previous row_hash, first is ZERO_HASH", async () => {
    const r1 = await appendAuditLog(db, baseInput({ action: "role.created" }));
    const r2 = await appendAuditLog(db, baseInput({ action: "role.updated" }));
    const r3 = await appendAuditLog(db, baseInput({ action: "role.deleted" }));

    expect(r1.prevHash).toBe(ZERO_HASH);
    expect(r2.prevHash).toBe(r1.rowHash);
    expect(r3.prevHash).toBe(r2.rowHash);

    // Distinct row hashes -- not a degenerate chain where every row hashes the same.
    expect(new Set([r1.rowHash, r2.rowHash, r3.rowHash]).size).toBe(3);
    expect(r1.seq < r2.seq && r2.seq < r3.seq).toBe(true);
  });

  it("rejects an unknown action as a programmer error", async () => {
    await expect(
      appendAuditLog(db, baseInput({ action: "not.a.real.action" })),
    ).rejects.toThrow(/unknown audit action/i);
  });

  it("rejects legal_hold.placed/lifted as not yet wired", async () => {
    await expect(
      appendAuditLog(db, baseInput({ action: "legal_hold.placed" })),
    ).rejects.toThrow(/not wired yet/i);
    await expect(
      appendAuditLog(db, baseInput({ action: "legal_hold.lifted" })),
    ).rejects.toThrow(/not wired yet/i);
  });

  it("refuses to write an obvious secret value", async () => {
    await expect(
      appendAuditLog(
        db,
        baseInput({
          action: "plugin.changed",
          before: null,
          after: { apiKey: "sk_live_abc123" },
        }),
      ),
    ).rejects.toThrow(/looks like a secret value/i);
  });

  it("truncates a before/after payload larger than 64 KB with a marker", async () => {
    const bigString = "x".repeat(70 * 1024);
    const result = await appendAuditLog(
      db,
      baseInput({ action: "config.exported", after: { blob: bigString } }),
    );
    const raw = await readRawRow(result.id);
    const after = raw.after as Record<string, unknown>;
    expect(after.__truncated).toBe(true);
  });

  it("records organisation_id, and the FK is ON DELETE SET NULL (AU-7 tombstone)", async () => {
    const organisation = await makeOrganisation();
    const result = await appendAuditLog(
      db,
      baseInput({
        action: "organisation.created",
        organisationId: organisation.id,
      }),
    );
    let raw = await db.execute<{ organisation_id: string | null }>(
      sql`SELECT organisation_id FROM audit_log WHERE id = ${result.id}`,
    );
    expect(raw.rows[0]?.organisation_id).toBe(organisation.id);

    await db
      .delete(schema.organisationTable)
      .where(eq(schema.organisationTable.id, organisation.id));

    raw = await db.execute<{ organisation_id: string | null }>(
      sql`SELECT organisation_id FROM audit_log WHERE id = ${result.id}`,
    );
    expect(raw.rows[0]?.organisation_id).toBeNull();
  });
});

describe("audit_log append-only trigger", () => {
  it("refuses an UPDATE", async () => {
    const result = await appendAuditLog(db, baseInput());
    await expectRejectionMatching(
      db.execute(
        sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${result.id}`,
      ),
      /append-only/i,
    );
  });

  it("refuses a DELETE", async () => {
    const result = await appendAuditLog(db, baseInput());
    await expectRejectionMatching(
      db.execute(sql`DELETE FROM audit_log WHERE id = ${result.id}`),
      /append-only/i,
    );
  });

  it("refuses a TRUNCATE, and the rows survive", async () => {
    await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());

    await expectRejectionMatching(
      db.execute(sql`TRUNCATE audit_log`),
      /append-only/i,
    );

    const countResult = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM audit_log`,
    );
    expect(countResult.rows[0]?.count).toBe("3");
  });
});

describe("concurrent appendAuditLog calls stay linear", () => {
  it("N parallel appends produce one linear chain with no duplicate prev_hash", async () => {
    const concurrency = 10;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        appendAuditLog(db, baseInput({ entityId: `concurrent-${i}` })),
      ),
    );

    const prevHashes = results.map((r) => r.prevHash);
    const uniquePrevHashes = new Set(prevHashes);
    expect(uniquePrevHashes.size).toBe(concurrency);

    const rowHashes = new Set(results.map((r) => r.rowHash));
    expect(rowHashes.size).toBe(concurrency);

    // Every row_hash except the last-inserted one is used as some OTHER row's
    // prev_hash, and exactly one row's prev_hash is ZERO_HASH -- i.e. the chain is a
    // single linked list, not a fork or multiple disjoint chains.
    const zeroHashCount = prevHashes.filter((h) => h === ZERO_HASH).length;
    expect(zeroHashCount).toBe(1);

    const usedAsPrevHash = new Set(prevHashes);
    const rowHashArray = [...rowHashes];
    const headCandidates = rowHashArray.filter((h) => !usedAsPrevHash.has(h));
    expect(headCandidates.length).toBe(1);

    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.rowsChecked).toBe(concurrency);
  });
});

describe("verifyAuditChain", () => {
  it("reports ok for an untampered chain", async () => {
    await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(true);
    expect(result.rowsChecked).toBe(3);
    expect(result.firstBreak).toBeNull();
  });

  it("detects a tampered `after` payload (DB-owner-level tamper, bypassing the API)", async () => {
    const r1 = await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());
    await appendAuditLog(db, baseInput());

    // The trigger blocks this through the normal writer path; simulate a
    // database-level actor with elevated privilege by disabling the trigger for this
    // one statement, same as `audit-verify`'s whole reason to exist.
    await db.execute(
      sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`,
    );
    try {
      await db.execute(
        sql`UPDATE audit_log SET after = '{"name":"Tampered"}'::jsonb WHERE id = ${r1.id}`,
      );
    } finally {
      await db.execute(
        sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`,
      );
    }

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(false);
    expect(result.firstBreak?.id).toBe(r1.id);
    expect(result.firstBreak?.reason).toBe("row_hash_mismatch");
  });

  it("detects a tampered `before` payload", async () => {
    const r1 = await appendAuditLog(db, baseInput({ before: { name: "Old" } }));

    await db.execute(
      sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`,
    );
    try {
      await db.execute(
        sql`UPDATE audit_log SET before = '{"name":"Tampered"}'::jsonb WHERE id = ${r1.id}`,
      );
    } finally {
      await db.execute(
        sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`,
      );
    }

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(false);
    expect(result.firstBreak?.id).toBe(r1.id);
    expect(result.firstBreak?.reason).toBe("row_hash_mismatch");
  });

  it("detects a deleted middle row (prev_hash pointer broken)", async () => {
    await appendAuditLog(db, baseInput());
    const r2 = await appendAuditLog(db, baseInput());
    const r3 = await appendAuditLog(db, baseInput());

    await db.execute(
      sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`,
    );
    try {
      await db.execute(sql`DELETE FROM audit_log WHERE id = ${r2.id}`);
    } finally {
      await db.execute(
        sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`,
      );
    }

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(false);
    // r2's seq is missing from the walk entirely -- detected as a sequence gap at r3,
    // before its (now-unverifiable) prev_hash pointer is even checked.
    expect(result.firstBreak?.id).toBe(r3.id);
    expect(result.firstBreak?.reason).toBe("sequence_gap");
  });
});
