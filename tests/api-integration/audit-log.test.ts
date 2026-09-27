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

  it("accepts an events.md-keyed domain-event action (#360)", async () => {
    // `work_item.assigned` is the exact key the assign route writes
    // (`docs/03-features/assignment.md` via `audit-trail.md`'s "where a domain event
    // exists for the mutation, the audit action is that event's key"). Before #360
    // this threw "unknown audit action", which is what left #353's audit box
    // untickable.
    const result = await appendAuditLog(
      db,
      baseInput({
        action: "work_item.assigned",
        entityType: "work_item",
        entityId: `wi-${randomUUID()}`,
        before: { assigneeId: null },
        after: { assigneeId: `person-${randomUUID()}` },
      }),
    );

    const raw = await readRawRow(result.id);
    expect(raw.action).toBe("work_item.assigned");
    expect(raw.prev_hash).toBe(ZERO_HASH);

    // The chain still verifies with a domain-event-keyed row on it — the allowlist
    // change must not have created a row shape the verifier rejects.
    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.rowsChecked).toBe(1);
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
          after: { apiKey: "fake-api-key-for-test" },
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
    // r2 is gone, so r3's stored prev_hash (r2's row_hash) no longer matches the
    // chain's actual running expected hash (r1's row_hash) -- S1 fix (Opus review of
    // PR #291): a missing/deleted row is caught by THIS check alone, never by a
    // seq-contiguity check, which would also fire on a merely rolled-back append (see
    // "a rolled-back write leaves a harmless seq gap" below).
    expect(result.firstBreak?.id).toBe(r3.id);
    expect(result.firstBreak?.reason).toBe("prev_hash_mismatch");
  });

  it("a rolled-back write leaves a harmless seq gap -- verify still reports ok (S1)", async () => {
    // Opus security review of PR #291, S1: `seq` is `GENERATED ALWAYS AS IDENTITY`,
    // which is non-transactional -- a rolled-back append still consumes a seq value,
    // leaving a permanent, entirely legitimate gap. The chain itself is intact (the
    // rolled-back row never existed to chain from), so this must NOT be reported as a
    // break.
    await appendAuditLog(db, baseInput());
    await db
      .transaction(async (tx) => {
        await appendAuditLog(tx, baseInput());
        throw new Error("deliberate rollback");
      })
      .catch(() => {});
    await appendAuditLog(db, baseInput());

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(true);
    expect(result.rowsChecked).toBe(2);
    expect(result.firstBreak).toBeNull();
  });

  it("a rolled-back savepoint inside a committed outer transaction is also harmless (S1)", async () => {
    await appendAuditLog(db, baseInput());
    await db.transaction(async (tx) => {
      await appendAuditLog(tx, baseInput());
      await tx
        .transaction(async (nestedTx) => {
          await appendAuditLog(nestedTx, baseInput());
          throw new Error("deliberate savepoint rollback");
        })
        .catch(() => {});
      await appendAuditLog(tx, baseInput());
    });

    const result = await verifyAuditChain(db);
    expect(result.ok).toBe(true);
    expect(result.rowsChecked).toBe(3);
  });
});

describe("appendAuditLog / verifyAuditChain -- top-level JSON shapes (S2)", () => {
  it.each([
    ["a string", "hello"],
    ["a numeric-looking string", "123"],
    ['the string "null"', "null"],
    ["a JSON-object-looking string", '{"a":1}'],
    ["a number", 42],
    ["a boolean", true],
    ["an empty array", []],
    ["a non-empty array", [1, 2, 3]],
    ["an object", { a: 1 }],
  ] as const)(
    "round-trips %s as a top-level `after` value, and verify stays ok",
    async (_label, value) => {
      const result = await appendAuditLog(
        db,
        baseInput({ after: value as JsonValue }),
      );
      const raw = await readRawRow(result.id);
      expect(raw.after).toEqual(value);

      const verifyResult = await verifyAuditChain(db);
      expect(verifyResult.ok).toBe(true);
    },
  );

  it("round-trips null as before/after", async () => {
    const result = await appendAuditLog(
      db,
      baseInput({ before: null, after: null }),
    );
    const raw = await readRawRow(result.id);
    expect(raw.before).toBeNull();
    expect(raw.after).toBeNull();

    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
  });
});

describe("audit_log_prev_hash_unique (S3)", () => {
  it("refuses a forced duplicate prev_hash insert", async () => {
    const r1 = await appendAuditLog(db, baseInput());
    const forcedId = `forced-${randomUUID()}`;
    const forcedRowHash = "9".repeat(64);
    await expectRejectionMatching(
      db.execute(
        sql`INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, prev_hash, row_hash)
            VALUES (${forcedId}, 'system', 'test.action', 'foo', 'bar', ${r1.prevHash}, ${forcedRowHash})`,
      ),
      /duplicate key value violates unique constraint "audit_log_prev_hash_unique"/i,
    );
  });

  it("the very first row's ZERO_HASH prev_hash does not conflict with anything", async () => {
    // Only one row can EVER be the first row in a non-empty table -- the constraint
    // does not (and must not) block the ordinary case of a fresh, empty audit_log.
    const result = await appendAuditLog(db, baseInput());
    expect(result.prevHash).toBe(ZERO_HASH);
  });
});

describe("AU-7 tombstone carve-out is tightened to the real FK action (S4)", () => {
  it("refuses a direct UPDATE ... SET organisation_id = NULL while the organisation still exists", async () => {
    const organisation = await makeOrganisation();
    const result = await appendAuditLog(
      db,
      baseInput({
        action: "organisation.created",
        organisationId: organisation.id,
      }),
    );

    await expectRejectionMatching(
      db.execute(
        sql`UPDATE audit_log SET organisation_id = NULL WHERE id = ${result.id}`,
      ),
      /append-only/i,
    );

    const raw = await db.execute<{ organisation_id: string | null }>(
      sql`SELECT organisation_id FROM audit_log WHERE id = ${result.id}`,
    );
    expect(raw.rows[0]?.organisation_id).toBe(organisation.id);
  });

  it("still tombstones when the organisation is actually deleted", async () => {
    const organisation = await makeOrganisation();
    const result = await appendAuditLog(
      db,
      baseInput({
        action: "organisation.created",
        organisationId: organisation.id,
      }),
    );

    await db
      .delete(schema.organisationTable)
      .where(eq(schema.organisationTable.id, organisation.id));

    const raw = await db.execute<{ organisation_id: string | null }>(
      sql`SELECT organisation_id FROM audit_log WHERE id = ${result.id}`,
    );
    expect(raw.rows[0]?.organisation_id).toBeNull();
  });
});

describe("AU-2 secret backstop -- segment matching, not substring (S6)", () => {
  const secretShapedPayloads: Array<[string, JsonValue]> = [
    ["password as a string", { password: "hunter2" }],
    ["password as an array (S6 bypass)", { password: ["hunter2"] }],
    ["token as a number (S6 bypass)", { token: 123456 }],
    [
      "nested credentials object (S6 bypass)",
      { credentials: { value: "s3cr3t" } },
    ],
    ["pwd (S6 bypass)", { pwd: "hunter2" }],
    ["passphrase (S6 bypass)", { passphrase: "correct horse battery staple" }],
    ["apiKey compound segment pair", { apiKey: "fake-api-key-for-test" }],
    ["privateKey compound segment pair", { privateKey: "-----BEGIN KEY-----" }],
    [
      "dotted path smtp.password (S6 delta round)",
      { "smtp.password": "hunter2" },
    ],
    [
      "dotted path auth.password (S6 delta round)",
      { "auth.password": "hunter2" },
    ],
  ];

  it.each(secretShapedPayloads)("refuses %s", async (_label, after) => {
    await expect(
      appendAuditLog(db, baseInput({ action: "plugin.changed", after })),
    ).rejects.toThrow(/looks like a secret value/i);
  });

  const metadataShapedPayloads: Array<[string, JsonValue]> = [
    ["apiKeyId (S6 false positive)", { apiKeyId: "key_123" }],
    [
      "secretRotatedAt (S6 false positive)",
      { secretRotatedAt: "2026-09-23T00:00:00Z" },
    ],
    [
      "tokenExpiresAt (S6 false positive)",
      { tokenExpiresAt: "2026-09-23T00:00:00Z" },
    ],
    ["a webhook secretCount", { secretCount: 3 }],
  ];

  it.each(metadataShapedPayloads)(
    "allows %s -- it names metadata, not the secret itself",
    async (_label, after) => {
      const result = await appendAuditLog(
        db,
        baseInput({ action: "plugin.changed", after }),
      );
      const raw = await readRawRow(result.id);
      expect(raw.after).toEqual(after);
    },
  );
});

describe("appendAuditLog / verifyAuditChain -- sparse arrays (S7)", () => {
  it("a top-level array hole is hashed and stored identically", async () => {
    // A genuine array hole (`Array.prototype.map` skips it, `JSON.stringify` renders
    // it as `null`) -- Opus security review of PR #291, delta round, S7. Built via
    // assignment past the end, not sparse-array literal syntax, so no lint suppression
    // is needed here.
    const sparse: unknown[] = [];
    sparse[1] = 1;

    const result = await appendAuditLog(
      db,
      baseInput({ after: sparse as unknown as JsonValue }),
    );
    const raw = await readRawRow(result.id);
    expect(raw.after).toEqual([null, 1]);

    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
  });

  it("a hole nested inside an object is hashed and stored identically", async () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;

    const result = await appendAuditLog(
      db,
      baseInput({ after: { list: sparse } as unknown as JsonValue }),
    );
    const raw = await readRawRow(result.id);
    expect(raw.after).toEqual({ list: [null, 1] });

    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
  });

  it("a hole nested inside nested arrays is hashed and stored identically", async () => {
    const innerSparse: unknown[] = [];
    innerSparse[1] = 1;
    const outer: unknown[] = [innerSparse, "sibling"];

    const result = await appendAuditLog(
      db,
      baseInput({ after: outer as unknown as JsonValue }),
    );
    const raw = await readRawRow(result.id);
    expect(raw.after).toEqual([[null, 1], "sibling"]);

    const verifyResult = await verifyAuditChain(db);
    expect(verifyResult.ok).toBe(true);
  });

  it("property-style: a table of awkward inputs all append and verify ok", async () => {
    const topLevelSparse: unknown[] = [];
    topLevelSparse[2] = "third";

    const awkwardInputs: Array<[string, unknown]> = [
      ["a top-level array hole", topLevelSparse],
      ["negative zero", -0],
      ["an object with an undefined member", { present: 1, absent: undefined }],
      [
        "a nested plain object with no toJSON",
        { outer: { inner: { value: true, list: [1, 2, 3] } } },
      ],
      ["unicode content", { name: "héllo wörld – 日本語 🎉", combining: "é" }],
    ];

    for (const [_label, value] of awkwardInputs) {
      const result = await appendAuditLog(
        db,
        baseInput({
          entityId: `s7-${randomUUID()}`,
          after: value as JsonValue,
        }),
      );
      const raw = await readRawRow(result.id);
      // What came back from `audit_log` must deep-equal the SAME JSON round trip
      // `appendAuditLog` itself applies before hashing/storing -- jsonb does not
      // preserve object key insertion order, so this compares by VALUE, never by the
      // serialised text's byte order.
      expect(raw.after).toEqual(JSON.parse(JSON.stringify(value)));

      const verifyResult = await verifyAuditChain(db);
      expect(verifyResult.ok).toBe(true);
    }
  });
});
