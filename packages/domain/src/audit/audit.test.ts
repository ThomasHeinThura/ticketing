import { describe, expect, it } from "vitest";
import { canonicalRowHash, reconstructAt, ZERO_HASH } from "./audit.js";
import type { ActivityRow, AuditLogRow, JsonValue } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/**
 * The golden-file fixture (`p2-domain.md` §5's `audit/` test list: "a fixed input row
 * producing a known, pinned hash value"). Computed once, offline, with the exact same
 * algorithm `audit.ts` implements (see the pull request description), then hard-coded
 * below as `GOLDEN_HASH` — a deliberate regression trap: a future accidental change to
 * field order, the separator, or the JSON canonicalization must break this test.
 */
const GOLDEN_ROW: AuditLogRow = {
  createdAt: "2026-09-05T14:03:11.123456Z",
  actorId: "person_01HXYZ",
  actorType: "person",
  apiKeyId: null,
  impersonatorId: null,
  actorIp: "203.0.113.7",
  userAgent: "Mozilla/5.0 (compatible; test-agent/1.0)",
  traceId: "trace-abc123def456",
  workspaceId: "workspace_01HAAA",
  action: "work_item.updated",
  entityType: "work_item",
  entityId: "work_item_01HBBB",
  before: { priority: "medium", labels: ["bug", "urgent"] },
  after: { priority: "high", labels: ["bug", "urgent"] },
};

const GOLDEN_HASH =
  "a3e7d4224022e6c960cfe5673255a0b227ed453f9db072cf3f1acd890a61714a";

/** A second, differently-shaped golden fixture: system actor, null `before`, non-zero `prevHash`. */
const SECOND_GOLDEN_ROW: AuditLogRow = {
  createdAt: "2026-01-01T00:00:00.000000Z",
  actorId: null,
  actorType: "system",
  apiKeyId: null,
  impersonatorId: null,
  actorIp: null,
  userAgent: null,
  traceId: "trace-system-001",
  workspaceId: null,
  action: "audit.purged",
  entityType: "audit_log",
  entityId: "purge_run_01",
  before: null,
  after: { purgedCount: 42 },
};
const SECOND_GOLDEN_PREV_HASH = "a".repeat(64);
const SECOND_GOLDEN_HASH =
  "612f2f06caeea24434b405388a295b2c959a56253feac41820aeecfde2fba2ad";

// ---------------------------------------------------------------------------
// canonicalRowHash — the hash chain (AU-15, data-model.md § "The audit hash chain").
// ---------------------------------------------------------------------------

describe("canonicalRowHash", () => {
  it("produces the pinned golden hash for a fixed row", () => {
    expect(canonicalRowHash(GOLDEN_ROW, ZERO_HASH)).toBe(GOLDEN_HASH);
  });

  it("produces the pinned golden hash for a second, differently-shaped row", () => {
    expect(canonicalRowHash(SECOND_GOLDEN_ROW, SECOND_GOLDEN_PREV_HASH)).toBe(
      SECOND_GOLDEN_HASH,
    );
  });

  it("is deterministic — the same row and prevHash always hash the same", () => {
    const first = canonicalRowHash(GOLDEN_ROW, ZERO_HASH);
    const second = canonicalRowHash({ ...GOLDEN_ROW }, ZERO_HASH);
    expect(first).toBe(second);
  });

  it("returns 64 lowercase hex characters", () => {
    expect(canonicalRowHash(GOLDEN_ROW, ZERO_HASH)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ZERO_HASH is 64 lowercase hex '0' characters", () => {
    expect(ZERO_HASH).toBe("0".repeat(64));
    expect(ZERO_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changing prevHash changes the hash", () => {
    const withZero = canonicalRowHash(GOLDEN_ROW, ZERO_HASH);
    const withOther = canonicalRowHash(GOLDEN_ROW, "a".repeat(64));
    expect(withOther).not.toBe(withZero);
  });

  describe("null vs empty-string indistinguishability (deliberate, data-model.md)", () => {
    it("a null impersonatorId and an empty-string impersonatorId hash identically", () => {
      const nullRow: AuditLogRow = { ...GOLDEN_ROW, impersonatorId: null };
      const emptyRow: AuditLogRow = { ...GOLDEN_ROW, impersonatorId: "" };
      expect(canonicalRowHash(nullRow, ZERO_HASH)).toBe(
        canonicalRowHash(emptyRow, ZERO_HASH),
      );
      // And both match the golden hash, since GOLDEN_ROW already has impersonatorId: null.
      expect(canonicalRowHash(nullRow, ZERO_HASH)).toBe(GOLDEN_HASH);
    });

    it("generalises to another nullable text column (actorIp)", () => {
      const nullRow: AuditLogRow = { ...GOLDEN_ROW, actorIp: null };
      const emptyRow: AuditLogRow = { ...GOLDEN_ROW, actorIp: "" };
      expect(canonicalRowHash(nullRow, ZERO_HASH)).toBe(
        canonicalRowHash(emptyRow, ZERO_HASH),
      );
    });

    it("does NOT apply to jsonb: a null before and an empty-object before hash differently", () => {
      // The recipe's "null and empty string are indistinguishable" note is stated for the
      // plain UTF-8-text columns. jsonb has its own, separate rule ("a null jsonb is the
      // empty string") which does not equate `null` with an empty *object* `{}` — those
      // are two different jsonb values and must hash differently.
      const nullBefore: AuditLogRow = { ...GOLDEN_ROW, before: null };
      const emptyObjectBefore: AuditLogRow = { ...GOLDEN_ROW, before: {} };
      expect(canonicalRowHash(nullBefore, ZERO_HASH)).not.toBe(
        canonicalRowHash(emptyObjectBefore, ZERO_HASH),
      );
    });
  });

  describe("RFC 8785 canonical JSON for before/after", () => {
    it("key order in before/after does not affect the hash", () => {
      const reordered: AuditLogRow = {
        ...GOLDEN_ROW,
        before: { labels: ["bug", "urgent"], priority: "medium" },
        after: { labels: ["bug", "urgent"], priority: "high" },
      };
      expect(canonicalRowHash(reordered, ZERO_HASH)).toBe(GOLDEN_HASH);
    });

    it("key order in nested objects and objects inside arrays does not affect the hash", () => {
      const a: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { outer: { z: 1, a: 2 }, list: [{ y: 1, x: 2 }] },
      };
      const b: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { list: [{ x: 2, y: 1 }], outer: { a: 2, z: 1 } },
      };
      expect(canonicalRowHash(a, ZERO_HASH)).toBe(
        canonicalRowHash(b, ZERO_HASH),
      );
    });

    it("array element order is preserved and does affect the hash", () => {
      const ascending: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { list: [1, 2, 3] },
      };
      const descending: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { list: [3, 2, 1] },
      };
      expect(canonicalRowHash(ascending, ZERO_HASH)).not.toBe(
        canonicalRowHash(descending, ZERO_HASH),
      );
    });

    it("negative zero and positive zero hash identically (ECMA-262 Number::toString)", () => {
      const negZero: AuditLogRow = { ...GOLDEN_ROW, after: { count: -0 } };
      const posZero: AuditLogRow = { ...GOLDEN_ROW, after: { count: 0 } };
      expect(canonicalRowHash(negZero, ZERO_HASH)).toBe(
        canonicalRowHash(posZero, ZERO_HASH),
      );
    });

    it("handles unicode content deterministically", () => {
      const unicodeRow: AuditLogRow = {
        ...GOLDEN_ROW,
        before: { note: "héllo wörld 日本語 🎉" },
      };
      const first = canonicalRowHash(unicodeRow, ZERO_HASH);
      const second = canonicalRowHash({ ...unicodeRow }, ZERO_HASH);
      expect(first).toBe(second);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("field-order / field-separator sensitivity", () => {
    it("changing any single hashed column changes the hash", () => {
      const base = canonicalRowHash(GOLDEN_ROW, ZERO_HASH);
      const variants: Array<Partial<AuditLogRow>> = [
        { actorId: "person_other" },
        { actorType: "system" },
        { apiKeyId: "key_01" },
        { impersonatorId: "person_impersonator" },
        { actorIp: "198.51.100.1" },
        { userAgent: "different-agent" },
        { traceId: "trace-different" },
        { workspaceId: "workspace_different" },
        { action: "work_item.deleted" },
        { entityType: "comment" },
        { entityId: "different_entity" },
        { createdAt: "2026-09-05T14:03:11.123457Z" },
      ];
      for (const variant of variants) {
        const row: AuditLogRow = { ...GOLDEN_ROW, ...variant };
        expect(canonicalRowHash(row, ZERO_HASH)).not.toBe(base);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Opus security review of PR #175 — remediation regression tests (S-1..S-4).
  // -------------------------------------------------------------------------

  describe("S-1: non-finite jsonb numbers must not silently canonicalize to null", () => {
    it("throws for a number beyond IEEE-754 double range (1e400)", () => {
      // The literal overflows to Infinity at parse time, exactly as it would decoding a
      // real out-of-range jsonb numeric via JSON.parse (Opus review, S-1) — that overflow
      // is the point of this test, not a mistake.
      // biome-ignore lint/correctness/noPrecisionLoss: deliberately out of range for this test
      const row: AuditLogRow = { ...GOLDEN_ROW, after: { amount: 1e400 } };
      expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(/non-finite/i);
    });

    it("throws for a different out-of-range number (9e400) — no longer collides with 1e400", () => {
      // Same as above — deliberately out-of-range, both this and 1e400 overflow to
      // Infinity and must both throw.
      // biome-ignore lint/correctness/noPrecisionLoss: deliberately out of range for this test
      const row: AuditLogRow = { ...GOLDEN_ROW, after: { amount: 9e400 } };
      expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(/non-finite/i);
    });

    it("throws for a literal Infinity", () => {
      const row: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { amount: Number.POSITIVE_INFINITY },
      };
      expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(/non-finite/i);
    });

    it("throws for a literal -Infinity", () => {
      const row: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { amount: Number.NEGATIVE_INFINITY },
      };
      expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(/non-finite/i);
    });

    it("a plain null after still hashes fine — distinguishing it from the previously-colliding non-finite values", () => {
      const row: AuditLogRow = { ...GOLDEN_ROW, after: null };
      expect(() => canonicalRowHash(row, ZERO_HASH)).not.toThrow();
      expect(canonicalRowHash(row, ZERO_HASH)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("does not reject legitimate finite doubles outside Number.MAX_SAFE_INTEGER (not a Number.isSafeInteger check)", () => {
      const row: AuditLogRow = { ...GOLDEN_ROW, after: { amount: 1e21 } };
      expect(() => canonicalRowHash(row, ZERO_HASH)).not.toThrow();
    });
  });

  describe("S-2: the \\x1e join must be injective across field boundaries", () => {
    it("rejects the reviewer's demonstrated collision input — row A (separator inside userAgent)", () => {
      const rowA: AuditLogRow = {
        ...GOLDEN_ROW,
        userAgent: "Mozilla/5.0\x1etrace-FORGED",
        traceId: "trace-real-001",
      };
      expect(() => canonicalRowHash(rowA, ZERO_HASH)).toThrow(
        /record-separator/i,
      );
    });

    it("rejects the reviewer's demonstrated collision input — row B (separator inside traceId)", () => {
      const rowB: AuditLogRow = {
        ...GOLDEN_ROW,
        userAgent: "Mozilla/5.0",
        traceId: "trace-FORGED\x1etrace-real-001",
      };
      expect(() => canonicalRowHash(rowB, ZERO_HASH)).toThrow(
        /record-separator/i,
      );
    });

    it("both previously-colliding rows now fail closed instead of silently producing the same row_hash", () => {
      const rowA: AuditLogRow = {
        ...GOLDEN_ROW,
        userAgent: "Mozilla/5.0\x1etrace-FORGED",
        traceId: "trace-real-001",
      };
      const rowB: AuditLogRow = {
        ...GOLDEN_ROW,
        userAgent: "Mozilla/5.0",
        traceId: "trace-FORGED\x1etrace-real-001",
      };
      expect(() => canonicalRowHash(rowA, ZERO_HASH)).toThrow();
      expect(() => canonicalRowHash(rowB, ZERO_HASH)).toThrow();
    });

    it("rejects a record-separator in any of the other plain-text columns", () => {
      const variants: Array<Partial<AuditLogRow>> = [
        { createdAt: "x\x1ey" },
        { actorId: "x\x1ey" },
        { actorType: "x\x1ey" },
        { apiKeyId: "x\x1ey" },
        { impersonatorId: "x\x1ey" },
        { actorIp: "x\x1ey" },
        { userAgent: "x\x1ey" },
        { traceId: "x\x1ey" },
        { workspaceId: "x\x1ey" },
        { action: "x\x1ey" },
        { entityType: "x\x1ey" },
        { entityId: "x\x1ey" },
      ];
      for (const variant of variants) {
        const row: AuditLogRow = { ...GOLDEN_ROW, ...variant };
        expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(
          /record-separator/i,
        );
      }
    });

    it("rejects a prevHash that is not exactly 64 lowercase hex characters", () => {
      expect(() => canonicalRowHash(GOLDEN_ROW, "not-a-hash")).toThrow(
        /prevHash/i,
      );
      expect(() => canonicalRowHash(GOLDEN_ROW, "A".repeat(64))).toThrow(
        /prevHash/i,
      );
      expect(() => canonicalRowHash(GOLDEN_ROW, "a".repeat(63))).toThrow(
        /prevHash/i,
      );
    });

    it("rejects a prevHash smuggling a record-separator", () => {
      const smuggled = `${"a".repeat(63)}\x1e`;
      expect(() => canonicalRowHash(GOLDEN_ROW, smuggled)).toThrow(/prevHash/i);
    });
  });

  describe("S-3: canonicalJson must not silently collapse a non-plain object to {}", () => {
    it("throws for a Date value instead of silently hashing it as {}", () => {
      const row: AuditLogRow = {
        ...GOLDEN_ROW,
        after: {
          due_date: new Date("2026-03-14T00:00:00Z"),
        } as unknown as JsonValue,
      };
      expect(() => canonicalRowHash(row, ZERO_HASH)).toThrow(
        /non-plain object/i,
      );
    });

    it("two different Date values no longer collide — both throw instead of both hashing as {}", () => {
      const rowA: AuditLogRow = {
        ...GOLDEN_ROW,
        after: {
          due_date: new Date("2026-03-14T00:00:00Z"),
        } as unknown as JsonValue,
      };
      const rowB: AuditLogRow = {
        ...GOLDEN_ROW,
        after: {
          due_date: new Date("2026-03-19T00:00:00Z"),
        } as unknown as JsonValue,
      };
      expect(() => canonicalRowHash(rowA, ZERO_HASH)).toThrow();
      expect(() => canonicalRowHash(rowB, ZERO_HASH)).toThrow();
    });

    it("throws for a Map or Set reaching canonicalJson", () => {
      const withMap: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { s: new Map([["a", 1]]) } as unknown as JsonValue,
      };
      const withSet: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { s: new Set([1, 2]) } as unknown as JsonValue,
      };
      expect(() => canonicalRowHash(withMap, ZERO_HASH)).toThrow(
        /non-plain object/i,
      );
      expect(() => canonicalRowHash(withSet, ZERO_HASH)).toThrow(
        /non-plain object/i,
      );
    });

    it("a genuinely plain object with the same field name still hashes normally", () => {
      const row: AuditLogRow = {
        ...GOLDEN_ROW,
        after: { due_date: "2026-03-14" },
      };
      expect(() => canonicalRowHash(row, ZERO_HASH)).not.toThrow();
    });

    it("an object created with Object.create(null) (no prototype at all) is accepted", () => {
      const nullProtoObject = Object.create(null);
      nullProtoObject.priority = "high";
      const row: AuditLogRow = {
        ...GOLDEN_ROW,
        after: nullProtoObject as unknown as JsonValue,
      };
      expect(() => canonicalRowHash(row, ZERO_HASH)).not.toThrow();
    });
  });

  describe("S-1/S-2/S-3 regression: the guards leave both pinned golden hashes byte-identical", () => {
    it("GOLDEN_HASH is unchanged", () => {
      expect(canonicalRowHash(GOLDEN_ROW, ZERO_HASH)).toBe(GOLDEN_HASH);
    });

    it("SECOND_GOLDEN_HASH is unchanged", () => {
      expect(canonicalRowHash(SECOND_GOLDEN_ROW, SECOND_GOLDEN_PREV_HASH)).toBe(
        SECOND_GOLDEN_HASH,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// reconstructAt — point-in-time reconstruction (AU-8, AU-9).
// ---------------------------------------------------------------------------

function utc(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, s));
}

function row(
  sequence: number,
  createdAt: Date,
  field: string | null,
  newValue: string | null,
): ActivityRow {
  return { sequence, createdAt, field, newValue };
}

describe("reconstructAt", () => {
  it("returns null for an empty activityRows list, at any instant", () => {
    expect(reconstructAt([], utc(2026, 1, 1))).toBeNull();
  });

  it("returns null for an instant strictly before the earliest row (before creation)", () => {
    const rows: ActivityRow[] = [row(1, utc(2026, 3, 1), null, null)];
    expect(reconstructAt(rows, utc(2026, 2, 28))).toBeNull();
  });

  it("returns an empty snapshot at exactly the creation instant when creation carries no field", () => {
    const rows: ActivityRow[] = [row(1, utc(2026, 3, 1), null, null)];
    expect(reconstructAt(rows, utc(2026, 3, 1))).toEqual({ fields: {} });
  });

  it("includes a field change at exactly its own instant (inclusive)", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 3, 1), null, null),
      row(2, utc(2026, 3, 2), "priority", "high"),
    ];
    expect(reconstructAt(rows, utc(2026, 3, 2))).toEqual({
      fields: { priority: "high" },
    });
  });

  it("excludes a field change strictly after the query instant", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 3, 1), null, null),
      row(2, utc(2026, 3, 5), "priority", "high"),
    ];
    expect(reconstructAt(rows, utc(2026, 3, 3))).toEqual({ fields: {} });
  });

  it("folds multiple distinct fields correctly at a later instant", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 3, 1), null, null),
      row(2, utc(2026, 3, 2), "priority", "high"),
      row(3, utc(2026, 3, 3), "assignee_id", "person_01"),
      row(4, utc(2026, 3, 4), "due_date", "2026-04-01"),
    ];
    expect(reconstructAt(rows, utc(2026, 3, 10))).toEqual({
      fields: {
        priority: "high",
        assignee_id: "person_01",
        due_date: "2026-04-01",
      },
    });
  });

  it("a field that goes back and forth reflects the last value at or before the instant", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 1, 1), null, null),
      row(2, utc(2026, 1, 2), "priority", "low"),
      row(3, utc(2026, 1, 3), "priority", "high"),
      row(4, utc(2026, 1, 4), "priority", "low"),
      row(5, utc(2026, 1, 5), "priority", "high"),
    ];
    expect(reconstructAt(rows, utc(2026, 1, 2))).toEqual({
      fields: { priority: "low" },
    });
    expect(reconstructAt(rows, utc(2026, 1, 3))).toEqual({
      fields: { priority: "high" },
    });
    expect(reconstructAt(rows, utc(2026, 1, 4))).toEqual({
      fields: { priority: "low" },
    });
    expect(reconstructAt(rows, utc(2026, 1, 10))).toEqual({
      fields: { priority: "high" },
    });
  });

  it("tie-break: two rows at the exact same instant resolve by ascending sequence, higher sequence wins", () => {
    const sameInstant = utc(2026, 5, 1, 12, 0, 0);
    const rows: ActivityRow[] = [
      row(1, utc(2026, 5, 1), null, null),
      // Two automations firing on the same trigger — genuinely the same createdAt.
      row(3, sameInstant, "priority", "high"),
      row(2, sameInstant, "priority", "urgent"),
    ];
    // Regardless of array order, sequence 3 (the higher, later-inserted row) wins,
    // since it is applied after sequence 2 in the fold's ascending-sequence order.
    expect(reconstructAt(rows, sameInstant)).toEqual({
      fields: { priority: "high" },
    });
  });

  it("tie-break is independent of the input array's order", () => {
    const sameInstant = utc(2026, 5, 1, 12, 0, 0);
    const forward: ActivityRow[] = [
      row(1, utc(2026, 5, 1), null, null),
      row(2, sameInstant, "priority", "urgent"),
      row(3, sameInstant, "priority", "high"),
    ];
    const reversed = [...forward].reverse();
    expect(reconstructAt(forward, sameInstant)).toEqual(
      reconstructAt(reversed, sameInstant),
    );
    expect(reconstructAt(forward, sameInstant)).toEqual({
      fields: { priority: "high" },
    });
  });

  it("a tie between two DIFFERENT fields at the same instant keeps both", () => {
    const sameInstant = utc(2026, 5, 1, 12, 0, 0);
    const rows: ActivityRow[] = [
      row(1, utc(2026, 5, 1), null, null),
      row(2, sameInstant, "priority", "high"),
      row(3, sameInstant, "assignee_id", "person_02"),
    ];
    expect(reconstructAt(rows, sameInstant)).toEqual({
      fields: { priority: "high", assignee_id: "person_02" },
    });
  });

  it("reconstructs across a work item type change (field: type_id), no special-casing needed", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 1, 1), null, null),
      row(2, utc(2026, 1, 1), "type_id", "type_bug"),
      row(3, utc(2026, 2, 1), "type_id", "type_task"),
    ];
    expect(reconstructAt(rows, utc(2026, 1, 15))).toEqual({
      fields: { type_id: "type_bug" },
    });
    expect(reconstructAt(rows, utc(2026, 3, 1))).toEqual({
      fields: { type_id: "type_task" },
    });
  });

  it("reconstructs across a project move (field: project_id), no special-casing needed", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 1, 1), null, null),
      row(2, utc(2026, 1, 1), "project_id", "project_a"),
      row(3, utc(2026, 2, 1), "project_id", "project_b"),
    ];
    expect(reconstructAt(rows, utc(2026, 1, 15))).toEqual({
      fields: { project_id: "project_a" },
    });
    expect(reconstructAt(rows, utc(2026, 3, 1))).toEqual({
      fields: { project_id: "project_b" },
    });
  });

  it("a project move and a type change interleaved with other field changes reconstruct independently", () => {
    const rows: ActivityRow[] = [
      row(1, utc(2026, 1, 1), null, null),
      row(2, utc(2026, 1, 2), "priority", "medium"),
      row(3, utc(2026, 1, 3), "type_id", "type_bug"),
      row(4, utc(2026, 1, 4), "project_id", "project_a"),
      row(5, utc(2026, 1, 5), "priority", "high"),
      row(6, utc(2026, 1, 6), "project_id", "project_b"),
      row(7, utc(2026, 1, 7), "type_id", "type_task"),
    ];
    expect(reconstructAt(rows, utc(2026, 1, 4, 12))).toEqual({
      fields: {
        priority: "medium",
        type_id: "type_bug",
        project_id: "project_a",
      },
    });
    expect(reconstructAt(rows, utc(2026, 1, 10))).toEqual({
      fields: {
        priority: "high",
        type_id: "type_task",
        project_id: "project_b",
      },
    });
  });

  it("handles a single row with a field change at its own creation instant", () => {
    const rows: ActivityRow[] = [row(1, utc(2026, 6, 1), "priority", "high")];
    expect(reconstructAt(rows, utc(2026, 6, 1))).toEqual({
      fields: { priority: "high" },
    });
    expect(reconstructAt(rows, utc(2026, 5, 31))).toBeNull();
  });

  it("is independent of the input array's order for a larger, unsorted scenario", () => {
    const created = row(1, utc(2026, 1, 1), null, null);
    const c1 = row(2, utc(2026, 1, 2), "priority", "low");
    const c2 = row(3, utc(2026, 1, 4), "assignee_id", "person_01");
    const c3 = row(4, utc(2026, 1, 6), "priority", "high");
    const c4 = row(5, utc(2026, 1, 8), "due_date", "2026-02-01");
    const inOrder = [created, c1, c2, c3, c4];
    const shuffled = [c4, created, c3, c1, c2];

    for (const at of [
      utc(2026, 1, 3),
      utc(2026, 1, 5),
      utc(2026, 1, 7),
      utc(2026, 1, 9),
    ]) {
      expect(reconstructAt(shuffled, at)).toEqual(reconstructAt(inOrder, at));
    }
  });

  it("does not mutate the caller's activityRows array", () => {
    const rows: ActivityRow[] = [
      row(2, utc(2026, 1, 2), "priority", "high"),
      row(1, utc(2026, 1, 1), null, null),
    ];
    const before = [...rows];
    reconstructAt(rows, utc(2026, 1, 3));
    expect(rows).toEqual(before);
  });
});
