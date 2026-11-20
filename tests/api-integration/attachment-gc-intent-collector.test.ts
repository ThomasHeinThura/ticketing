/**
 * PTM-06 collector witnesses on a fresh, dedicated `_test` PostgreSQL database (never the live
 * database): the intent / tombstone rows of `attachment_object_gc`, F1 row-lifetime and R1 hold
 * parity, the null-safe shape CHECK, the old-collector fence, the capped schedule, fair FIFO
 * service, the filesystem role gate and the backend fingerprint fence.
 *
 * Storage is never reached for real: `deleteStorageObject` is spied, so every assertion about a
 * "storage call" is an assertion about that spy. `queued_at` is only ever compared in SQL (an
 * intent row carries 'infinity', which does not decode).
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { collectQueuedAttachmentObjects } from "../../apps/api/src/scheduler/attachment-cleanup";
import * as leaderLock from "../../apps/api/src/scheduler/leader-lock";
import * as storage from "../../apps/api/src/storage";
import { buildTenant, type Tenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

type GcRow = {
  object_key: string;
  attachment_id: string | null;
  storage_driver: string | null;
  attempts: number;
  retry_ms: number | null;
  queued_infinite: boolean;
  queued_ms: number;
};

const fingerprint = () => storage.getStorageBackendFingerprint();

async function insertIntent(input: {
  objectKey?: string;
  attachmentId: string;
  workspaceId: string;
  driver?: string;
  retryAtSql?: string;
  attempts?: number;
}) {
  const objectKey =
    input.objectKey ?? `workspace/w/final/${randomUUID()}-photo.png`;
  await db.execute(sql`
    INSERT INTO attachment_object_gc
      (object_key, source_workspace_id, attachment_id, storage_driver, queued_at, retry_at, attempts)
    VALUES (
      ${objectKey}, ${input.workspaceId}, ${input.attachmentId},
      ${input.driver ?? fingerprint()}, 'infinity'::timestamptz,
      ${sql.raw(input.retryAtSql ?? "now() - interval '1 minute'")},
      ${input.attempts ?? 0}
    )`);
  return objectKey;
}

async function insertLegacy(objectKey: string, queuedAtSql = "now()") {
  await db.execute(sql`
    INSERT INTO attachment_object_gc (object_key, source_workspace_id, queued_at)
    VALUES (${objectKey}, 'w', ${sql.raw(queuedAtSql)})`);
}

async function gcRow(objectKey: string): Promise<GcRow | undefined> {
  const result = await db.execute<GcRow>(sql`
    SELECT object_key, attachment_id, storage_driver, attempts,
           (extract(epoch FROM (retry_at - now())) * 1000)::float8 AS retry_ms,
           (queued_at = 'infinity'::timestamptz) AS queued_infinite,
           CASE WHEN queued_at = 'infinity'::timestamptz THEN 0
                ELSE (extract(epoch FROM (queued_at - now())) * 1000)::float8 END AS queued_ms
    FROM attachment_object_gc WHERE object_key = ${objectKey}`);
  return result.rows[0];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Within a minute of the expected delay (the collector's transaction start vs this read). */
const approxDays = (ms: number | null | undefined, days: number) =>
  expect(Math.abs((ms ?? Number.NaN) - days * DAY_MS)).toBeLessThan(60_000);

async function pendingAttachment(t: Tenant) {
  const id = randomUUID();
  return requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        id,
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        objectKey: `workspace/${t.workspaceId}/work-item/${t.workItem.id}/attachment/${id}/photo.png`,
        filename: "photo.png",
        mimeType: "image/png",
        size: 10,
        state: "pending",
        customerVisible: false,
      })
      .returning(),
    "pending attachment",
  );
}

const savedEnv = { ...process.env };
let removed: MockInstance<typeof storage.deleteStorageObject>;

beforeEach(async () => {
  await resetTestDatabase();
  delete process.env.TASKDESK_ROLE;
  delete process.env.TASKDESK_STORAGE_DRIVER;
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT =
    "/tmp/taskdesk-ptm06-collector";
  removed = vi.spyOn(storage, "deleteStorageObject").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

describe("attachment_object_gc intent shape CHECK and old-collector fence", () => {
  it("rejects a half-filled intent row (23514) and accepts legacy, filesystem and S3 intents", async () => {
    const bad = (values: string) =>
      db.execute(
        sql.raw(
          `INSERT INTO attachment_object_gc (object_key, source_workspace_id, attachment_id, storage_driver, queued_at, retry_at) VALUES ${values}`,
        ),
      );
    const code = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return undefined;
      } catch (error) {
        let current: unknown = error;
        for (let depth = 0; depth < 5 && current; depth++) {
          const value = (current as { code?: unknown }).code;
          if (typeof value === "string") return value;
          current = (current as { cause?: unknown }).cause;
        }
        return undefined;
      }
    };
    // attachment_id set, driver NULL (the shape a three-valued CHECK would let through).
    expect(await code(bad("('k1','w','a',NULL,'infinity',now())"))).toBe(
      "23514",
    );
    // workspace NULL.
    expect(
      await code(
        bad("('k2',NULL,'a','filesystem:0123456789abcdef','infinity',now())"),
      ),
    ).toBe("23514");
    // malformed fingerprint.
    expect(
      await code(bad("('k3','w','a','filesystem:xyz','infinity',now())")),
    ).toBe("23514");
    // finite queued_at on an intent row.
    expect(
      await code(bad("('k4','w','a','s3:0123456789abcdef',now(),now())")),
    ).toBe("23514");
    // retry_at NULL.
    expect(
      await code(bad("('k5','w','a','s3:0123456789abcdef','infinity',NULL)")),
    ).toBe("23514");

    await bad(
      "('ok-fs','w','a','filesystem:0123456789abcdef','infinity',now())",
    );
    await bad("('ok-s3','w','a','s3:0123456789abcdef','infinity',now())");
    await insertLegacy("ok-legacy");
    expect(await gcRow("ok-fs")).toMatchObject({ queued_infinite: true });
    expect(await gcRow("ok-legacy")).toMatchObject({ queued_infinite: false });
  });

  it("HEAD's exact collector SELECT never selects an intent or tombstone row", async () => {
    await insertIntent({
      attachmentId: "a",
      workspaceId: "w",
      objectKey: "intent",
    });
    await insertIntent({
      attachmentId: "b",
      workspaceId: "w",
      objectKey: "tombstone",
      driver: "s3:0123456789abcdef",
      attempts: 3,
    });
    await insertLegacy("legacy");
    const old = await db.execute<{ object_key: string }>(sql`
      SELECT "object_key" FROM "attachment_object_gc"
      WHERE "queued_at" <= now()
      ORDER BY "attempts" ASC, "queued_at" ASC, "object_key" ASC
      LIMIT 100`);
    expect(old.rows.map((row) => row.object_key)).toEqual(["legacy"]);
  });

  it("legacy writers (cascade, vacated key) still pass the CHECK beside intent rows", async () => {
    await insertIntent({ attachmentId: "a", workspaceId: "w", objectKey: "k" });
    await db.execute(sql`
      INSERT INTO attachment_object_gc (object_key, source_workspace_id, queued_at)
      VALUES ('v', 'w', now() + interval '1 hour')
      ON CONFLICT (object_key) DO UPDATE
        SET queued_at = GREATEST(attachment_object_gc.queued_at, EXCLUDED.queued_at)`);
    expect(await gcRow("v")).toBeDefined();
  });
});

describe("intent rows: F1 / R1 and the backend fence", () => {
  it("retains while an attachment row with the intent's id exists, with no storage call (attempts 0 -> 1, +1 day)", async () => {
    const t = await buildTenant("ptm06-f1");
    const row = await pendingAttachment(t);
    const key = await insertIntent({
      attachmentId: row.id,
      workspaceId: t.workspaceId,
    });
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ scanned: 1, retained: 1, degraded: false });
    expect(removed).not.toHaveBeenCalled();
    const after = await gcRow(key);
    expect(after?.attempts).toBe(1);
    approxDays(after?.retry_ms, 1);
  });

  it("collects after the row is gone: the filesystem locator is dropped after one successful delete", async () => {
    const t = await buildTenant("ptm06-gone");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
    });
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ deleted: 1, degraded: false });
    expect(removed).toHaveBeenCalledWith(key);
    expect(await gcRow(key)).toBeUndefined();
  });

  it("drops the locator without a storage call when an attachment row names the key", async () => {
    const t = await buildTenant("ptm06-key");
    const row = await pendingAttachment(t);
    const key = await insertIntent({
      objectKey: row.objectKey,
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
    });
    await collectQueuedAttachmentObjects();
    expect(removed).not.toHaveBeenCalled();
    expect(await gcRow(key)).toBeUndefined();
  });

  it("is independent of the clock: with the row present, a far past or far future retry_at never deletes", async () => {
    const t = await buildTenant("ptm06-clock");
    const row = await pendingAttachment(t);
    const key = await insertIntent({
      attachmentId: row.id,
      workspaceId: t.workspaceId,
      retryAtSql: "now() - interval '10 years'",
    });
    await collectQueuedAttachmentObjects();
    await db.execute(
      sql`UPDATE attachment_object_gc SET retry_at = now() - interval '1 second' WHERE object_key = ${key}`,
    );
    await collectQueuedAttachmentObjects();
    expect(removed).not.toHaveBeenCalled();
    expect(await gcRow(key)).toBeDefined();
  });

  it("retains an intent of another backend: no storage call, degraded, attempts 1 (+1 day)", async () => {
    const t = await buildTenant("ptm06-fp");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
      driver: "filesystem:0000000000000000",
    });
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ retained: 1, degraded: true });
    expect(removed).not.toHaveBeenCalled();
    const after = await gcRow(key);
    expect(after?.attempts).toBe(1);
    approxDays(after?.retry_ms, 1);
  });

  it.each(["jobs", "web"])(
    "retains a filesystem intent when the collector's configured role is %s, even if the fingerprints were equal",
    async (role) => {
      const t = await buildTenant(`ptm06-role-${role}`);
      process.env.TASKDESK_ROLE = role;
      // Written under the same role, so the fingerprint matches: only the role gate retains it.
      const key = await insertIntent({
        attachmentId: randomUUID(),
        workspaceId: t.workspaceId,
      });
      const outcome = await collectQueuedAttachmentObjects();
      expect(outcome).toMatchObject({ retained: 1, degraded: true });
      expect(removed).not.toHaveBeenCalled();
      expect(await gcRow(key)).toBeDefined();
    },
  );

  it("an intent written by a web process is retained by an all collector (the role is in the tuple)", async () => {
    const t = await buildTenant("ptm06-web-writer");
    process.env.TASKDESK_ROLE = "web";
    const webFingerprint = fingerprint();
    delete process.env.TASKDESK_ROLE;
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
      driver: webFingerprint,
    });
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ retained: 1, degraded: true });
    expect(removed).not.toHaveBeenCalled();
    expect(await gcRow(key)).toBeDefined();
  });

  it("a failed storage delete keeps the intent: attempts 1, due again now, degraded", async () => {
    const t = await buildTenant("ptm06-fail");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
    });
    removed.mockRejectedValueOnce(new Error("storage outage"));
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ retained: 1, degraded: true });
    const after = await gcRow(key);
    expect(after?.attempts).toBe(1);
    expect(Math.abs(after?.retry_ms ?? Number.NaN)).toBeLessThan(60_000);
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      deleted: 1,
    });
  });
});

describe("S3 tombstones", () => {
  beforeEach(() => {
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://fake-s3.example.test";
    process.env.S3_BUCKET = "taskdesk-test";
  });

  it("is never dropped: each successful re-delete counts an attempt on the capped schedule", async () => {
    const t = await buildTenant("ptm06-tomb");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
    });
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      deleted: 1,
    });
    let after = await gcRow(key);
    expect(after?.attempts).toBe(1);
    approxDays(after?.retry_ms, 1);
    // Not due yet: nothing happens.
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      scanned: 0,
    });
    for (const [attempts, days] of [
      [2, 2],
      [3, 4],
      [4, 8],
      [5, 16],
      [6, 30],
      [7, 30],
    ] as const) {
      await db.execute(
        sql`UPDATE attachment_object_gc SET retry_at = now() - interval '1 second' WHERE object_key = ${key}`,
      );
      await collectQueuedAttachmentObjects();
      after = await gcRow(key);
      expect(after?.attempts).toBe(attempts);
      approxDays(after?.retry_ms, days);
    }
    expect(removed).toHaveBeenCalledTimes(7);
  });

  it("saturates attempts at the integer maximum with a 30 day delay and no error", async () => {
    const t = await buildTenant("ptm06-sat");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
      attempts: 2147483647,
    });
    await collectQueuedAttachmentObjects();
    const after = await gcRow(key);
    expect(after?.attempts).toBe(2147483647);
    approxDays(after?.retry_ms, 30);
  });

  it("a late copy after the first delete is removed by the next scheduled re-delete", async () => {
    const t = await buildTenant("ptm06-late");
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
    });
    await collectQueuedAttachmentObjects();
    // The late copy lands now; the locator is still there and due again after the backdate.
    await db.execute(
      sql`UPDATE attachment_object_gc SET retry_at = now() - interval '1 second' WHERE object_key = ${key}`,
    );
    await collectQueuedAttachmentObjects();
    expect(removed.mock.calls.filter(([k]) => k === key)).toHaveLength(2);
    expect((await gcRow(key))?.attempts).toBe(2);
  });
});

describe("legacy rows and fair service", () => {
  it("legacy behaviour is unchanged: referenced key dropped untouched, unreferenced key deleted", async () => {
    const t = await buildTenant("ptm06-legacy");
    const row = await pendingAttachment(t);
    await insertLegacy(row.objectKey);
    await insertLegacy("orphan");
    const outcome = await collectQueuedAttachmentObjects();
    expect(outcome).toMatchObject({ scanned: 2, deleted: 1, retained: 1 });
    expect(removed).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith("orphan");
  });

  it("a failing legacy row counts one attempt and goes to the tail; a row queued after it is served first on the next run", async () => {
    await insertLegacy("failing", "now() - interval '2 minutes'");
    removed.mockImplementation(async (key: string) => {
      if (key === "failing") throw new Error("permanent");
    });
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      retained: 1,
      degraded: true,
    });
    expect((await gcRow("failing"))?.attempts).toBe(1);
    await insertLegacy("fresh", "now() - interval '1 second'");
    removed.mockClear();
    await collectQueuedAttachmentObjects(1);
    expect(removed.mock.calls.map(([key]) => key)).toEqual(["fresh"]);
  });

  it("an older tombstone is served in the first run ahead of a large legacy backlog", async () => {
    const t = await buildTenant("ptm06-fair");
    for (let index = 0; index < 150; index++)
      await insertLegacy(
        `bulk-${String(index).padStart(3, "0")}`,
        "now() - interval '1 minute'",
      );
    const key = await insertIntent({
      attachmentId: randomUUID(),
      workspaceId: t.workspaceId,
      retryAtSql: "now() - interval '1 hour'",
    });
    const outcome = await collectQueuedAttachmentObjects(20);
    expect(outcome.queueBacklog).toBe(true);
    expect(outcome.degraded).toBe(false);
    expect(removed.mock.calls[0]?.[0]).toBe(key);
  });

  it("reports queueBacklog only while due rows remain, and never as degraded", async () => {
    for (let index = 0; index < 5; index++) await insertLegacy(`row-${index}`);
    expect(await collectQueuedAttachmentObjects(5)).toMatchObject({
      scanned: 5,
      degraded: false,
    });
    for (let index = 0; index < 6; index++) await insertLegacy(`more-${index}`);
    const backlog = await collectQueuedAttachmentObjects(5);
    expect(backlog).toMatchObject({
      scanned: 5,
      queueBacklog: true,
      degraded: false,
    });
  });

  // The outer selection is a stale candidate list. Collector B selects a due key, then is held
  // BEFORE its locked per-row query (the per-row lease check is the hook point); collector A runs
  // the whole visit and commits a future retry. When B resumes, the repeated due predicate must
  // skip the row: no storage call, no attempt, no second schedule step. The gate is released in
  // `finally` so a failed assertion cannot leave collector B hanging.
  it.each([
    ["an S3 tombstone A just re-deleted", "tombstone"],
    ["an intent A just retained because its attachment row exists", "retained"],
  ] as const)(
    "a stale candidate is skipped when another collector already advanced its retry: %s",
    async (_label, kind) => {
      process.env.TASKDESK_STORAGE_DRIVER = "s3";
      process.env.S3_ENDPOINT = "https://fake-s3.example.test";
      process.env.S3_BUCKET = "taskdesk-test";
      const t = await buildTenant(`ptm06-stale-${kind}`);
      const owner =
        kind === "retained" ? await pendingAttachment(t) : undefined;
      const key = await insertIntent({
        attachmentId: owner?.id ?? randomUUID(),
        workspaceId: t.workspaceId,
      });

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signalReached: () => void = () => {};
      const reached = new Promise<void>((resolve) => {
        signalReached = resolve;
      });
      const realOwned = leaderLock.assertJobExecutionOwned;
      let calls = 0;
      vi.spyOn(leaderLock, "assertJobExecutionOwned").mockImplementation(
        async () => {
          calls += 1;
          if (calls === 1) {
            // Collector B: its key list is already selected; hold it before the locked query.
            signalReached();
            await gate;
          }
          return realOwned();
        },
      );

      let stale:
        | Promise<Awaited<ReturnType<typeof collectQueuedAttachmentObjects>>>
        | undefined;
      try {
        stale = collectQueuedAttachmentObjects();
        await reached;
        // Collector A (the second lease check passes straight through) runs the full visit.
        const first = await collectQueuedAttachmentObjects();
        expect(first).toMatchObject({ scanned: 1, degraded: false });
        const afterA = await gcRow(key);
        expect(afterA?.attempts).toBe(1);
        approxDays(afterA?.retry_ms, 1);
        const callsByA = removed.mock.calls.length;
        expect(callsByA).toBe(kind === "tombstone" ? 1 : 0);
        release();
        const resumed = await stale;
        // B skipped the row: scanned but neither deleted nor retained, and nothing else changed.
        expect(resumed).toMatchObject({
          scanned: 1,
          deleted: 0,
          retained: 0,
          degraded: false,
        });
        expect(removed.mock.calls.length).toBe(callsByA);
        const afterB = await gcRow(key);
        expect(afterB?.attempts).toBe(1);
        approxDays(afterB?.retry_ms, 1);
      } finally {
        release();
        await stale?.catch(() => undefined);
      }
    },
  );

  it("two concurrent collectors never delete one row twice (SKIP LOCKED)", async () => {
    const t = await buildTenant("ptm06-skip");
    const keys: string[] = [];
    for (let index = 0; index < 10; index++)
      keys.push(
        await insertIntent({
          attachmentId: randomUUID(),
          workspaceId: t.workspaceId,
        }),
      );
    removed.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 20)),
    );
    await Promise.all([
      collectQueuedAttachmentObjects(),
      collectQueuedAttachmentObjects(),
    ]);
    const seen = removed.mock.calls.map(([key]) => key as string);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(keys));
  });
});
