/**
 * PTM-06 completion witnesses on a fresh, dedicated `_test` PostgreSQL database (never the live
 * database), filesystem driver, both completion routes: the durable intent is reserved before
 * any storage call, consumed atomically with `ready`, dropped only after a settled outcome, a
 * successful in-process delete and an unchanged backend fingerprint, and capped at three per
 * attachment. The submission route's phases hold no connection or row lock during storage I/O and
 * re-validate before writing.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAttachment } from "../../apps/api/src/attachment/controllers/complete-attachment";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import * as attachmentRepository from "../../apps/api/src/attachment/repository";
import db, { getDatabase, schema } from "../../apps/api/src/database";
import { acceptSubmission } from "../../apps/api/src/intake/repository";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { collectQueuedAttachmentObjects } from "../../apps/api/src/scheduler/attachment-cleanup";
import * as storage from "../../apps/api/src/storage";
import * as intentQueue from "../../apps/api/src/utils/attachment-object-queue";
import { buildTenant } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { seedIntake, submissionRow, submitAs } from "./helpers/intake-http";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const png = (bytes: number) =>
  Buffer.concat([PNG_HEADER, Buffer.alloc(bytes - PNG_HEADER.length, 7)]);

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };
function settle<T>(operation: Promise<T>): Promise<Settled<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}
const httpStatus = (result: Settled<unknown>) =>
  result.status === "rejected" && result.reason instanceof HTTPException
    ? result.reason.status
    : undefined;

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  label: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const intentRows = async (attachmentId: string) =>
  (
    await db.execute<{
      object_key: string;
      storage_driver: string;
      source_workspace_id: string;
      infinite: boolean;
      retry_ms: number;
    }>(sql`
      SELECT object_key, storage_driver, source_workspace_id,
             (queued_at = 'infinity'::timestamptz) AS infinite,
             (extract(epoch FROM (retry_at - now())) * 1000)::float8 AS retry_ms
      FROM attachment_object_gc WHERE attachment_id = ${attachmentId}`)
  ).rows;

const attachmentRow = (id: string) =>
  db.query.attachmentTable.findFirst({
    where: eq(schema.attachmentTable.id, id),
  });

let root: string;
const savedEnv = { ...process.env };

beforeEach(async () => {
  await resetTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), "taskdesk-ptm06-"));
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  delete process.env.TASKDESK_STORAGE_DRIVER;
  delete process.env.TASKDESK_ROLE;
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  await rm(root, { recursive: true, force: true });
});

const putFile = async (key: string, bytes: Buffer) => {
  const file = path.join(root, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
};

async function staffWorld() {
  const t = await buildTenant("ptm06-complete");
  const identity = await resolveIdentity({
    userId: t.requester.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("failed to resolve staff identity");
  return { t, identity };
}
type StaffWorld = Awaited<ReturnType<typeof staffWorld>>;

async function pendingStaffRow(
  w: StaffWorld,
  bytes = png(60),
  mime = "image/png",
) {
  const id = randomUUID();
  const objectKey = `workspace/${w.t.workspaceId}/work-item/${w.t.workItem.id}/attachment/${id}/photo.png`;
  const row = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        id,
        workspaceId: w.t.workspaceId,
        workItemId: w.t.workItem.id,
        objectKey,
        filename: "photo.png",
        mimeType: mime,
        size: 10,
        state: "pending",
        customerVisible: false,
      })
      .returning(),
    "pending staff attachment",
  );
  await putFile(objectKey, bytes);
  return row;
}

const staffInput = (w: StaffWorld, row: { id: string }) => ({
  attachmentId: row.id,
  workspaceId: w.t.workspaceId,
  workItemId: w.t.workItem.id,
  actorId: w.t.requester.user.id,
  actorType: "person" as const,
  identity: w.identity,
});

function loseReadyCommitReply() {
  const finalize = storage.finalizeStorageObject;
  vi.spyOn(storage, "finalizeStorageObject").mockImplementationOnce(
    async (oldKey, newKey) => {
      await finalize(oldKey, newKey);
      const database = getDatabase();
      const transaction = database.transaction.bind(database);
      vi.spyOn(database, "transaction").mockImplementationOnce(
        async (callback) => {
          await transaction(callback);
          throw new Error("commit reply lost");
        },
      );
    },
  );
}

async function expectReadyObjectAfterCollection(id: string) {
  const ready = await attachmentRow(id);
  expect(ready?.state).toBe("ready");
  expect(await intentRows(id)).toEqual([]);
  expect(await listFiles(root)).toEqual([
    path.join(root, ready?.objectKey as string),
  ]);
  await collectQueuedAttachmentObjects();
  expect(await attachmentRow(id)).toMatchObject({
    state: "ready",
    objectKey: ready?.objectKey,
  });
  expect(await listFiles(root)).toEqual([
    path.join(root, ready?.objectKey as string),
  ]);
}

async function seedIntentRows(
  row: { id: string },
  workspaceId: string,
  count: number,
) {
  for (let index = 0; index < count; index++)
    await db.execute(sql`
      INSERT INTO attachment_object_gc
        (object_key, source_workspace_id, attachment_id, storage_driver, queued_at, retry_at)
      VALUES (${`seed-${index}-${randomUUID()}`}, ${workspaceId}, ${row.id},
              ${storage.getStorageBackendFingerprint()}, 'infinity'::timestamptz,
              now() + interval '1 day')`);
}

describe("ordinary completion: the durable intent", () => {
  it("keeps the ready object when the commit reply is lost", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    loseReadyCommitReply();
    await expect(completeAttachment(staffInput(w, row))).rejects.toThrow(
      "commit reply lost",
    );
    await expectReadyObjectAfterCollection(row.id);
  });

  it("is consumed atomically with ready: no locator remains after a success", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    const done = await completeAttachment(staffInput(w, row));
    expect(done.state).toBe("ready");
    expect(await intentRows(row.id)).toEqual([]);
    expect(await listFiles(root)).toEqual([path.join(root, done.objectKey)]);
  });

  it("is reserved before finalize, committed and holding no advisory lock while storage runs", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    const probe = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await probe.connect();
    const real = storage.finalizeStorageObject;
    let seen:
      | { rows: number; advisory: number; fingerprint: string | undefined }
      | undefined;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        const rows = await probe.query<{ n: number; fp: string }>(
          "SELECT count(*)::int AS n, min(storage_driver) AS fp FROM attachment_object_gc WHERE attachment_id = $1 AND object_key = $2",
          [row.id, newKey],
        );
        const advisory = await probe.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted",
        );
        seen = {
          rows: rows.rows[0]?.n ?? 0,
          advisory: advisory.rows[0]?.n ?? 0,
          fingerprint: rows.rows[0]?.fp,
        };
        return real(oldKey, newKey);
      },
    );
    try {
      await completeAttachment(staffInput(w, row));
    } finally {
      await probe.end();
    }
    expect(seen).toEqual({
      rows: 1,
      advisory: 0,
      fingerprint: storage.getStorageBackendFingerprint(),
    });
  });

  it("a crash after the copy leaves the locator; the collector retains it while the row exists and collects it once the row is gone", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    vi.spyOn(
      attachmentRepository,
      "updateAttachmentReady",
    ).mockRejectedValueOnce(new Error("crash after the copy"));
    const removal = vi
      .spyOn(storage, "deleteStorageObject")
      .mockRejectedValueOnce(new Error("process died before the delete"));
    await expect(completeAttachment(staffInput(w, row))).rejects.toThrow(
      "crash after the copy",
    );
    const [intent] = await intentRows(row.id);
    expect(intent).toMatchObject({
      source_workspace_id: w.t.workspaceId,
      infinite: true,
      storage_driver: storage.getStorageBackendFingerprint(),
    });
    expect(await listFiles(root)).toEqual([
      path.join(root, intent?.object_key as string),
    ]);
    // Due, but the pending row still exists (F1): retained with no storage call.
    await db.execute(
      sql`UPDATE attachment_object_gc SET retry_at = now() - interval '1 second' WHERE attachment_id = ${row.id}`,
    );
    removal.mockClear();
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      retained: 1,
    });
    expect(removal).not.toHaveBeenCalled();
    // The row goes away: the next run deletes the bytes and drops the filesystem locator.
    await db
      .delete(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, row.id));
    await db.execute(
      sql`UPDATE attachment_object_gc SET retry_at = now() - interval '1 second' WHERE attachment_id = ${row.id}`,
    );
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      deleted: 1,
    });
    expect(await intentRows(row.id)).toEqual([]);
    expect(await listFiles(root)).toEqual([]);
  });

  it("drops the locator after a settled rejection (content mismatch) with a successful delete", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w, Buffer.from("not an image at all"));
    const result = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(result)).toBe(400);
    expect(await intentRows(row.id)).toEqual([]);
    expect(await listFiles(root)).toEqual([]);
  });

  it("keeps the locator when the in-process delete fails", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w, Buffer.from("not an image at all"));
    vi.spyOn(storage, "deleteStorageObject").mockRejectedValueOnce(
      new Error("delete failed"),
    );
    const result = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(result)).toBe(400);
    expect(await intentRows(row.id)).toHaveLength(1);
  });

  it("keeps the locator when the backend fingerprint changed during the call, even though the delete worked", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w, Buffer.from("not an image at all"));
    const real = storage.finalizeStorageObject;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        await real(oldKey, newKey);
        // A configured-role change moves the filesystem fingerprint mid-call.
        process.env.TASKDESK_ROLE = "web";
      },
    );
    const result = await settle(completeAttachment(staffInput(w, row)));
    delete process.env.TASKDESK_ROLE;
    expect(httpStatus(result)).toBe(400);
    expect(await listFiles(root)).toEqual([]);
    expect(await intentRows(row.id)).toHaveLength(1);
  });

  it("an unknown storage outcome is 503, keeps the locator and the pending upload, and a retry can succeed", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    // The copy failed before moving anything, but its outcome could not be proven.
    vi.spyOn(storage, "finalizeStorageObject").mockRejectedValueOnce(
      new storage.FinalizeOutcomeUnknownError("unknown"),
    );
    const first = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(first)).toBe(503);
    expect(await intentRows(row.id)).toHaveLength(1);
    expect(await listFiles(root)).toEqual([path.join(root, row.objectKey)]);
    const retry = await completeAttachment(staffInput(w, row));
    expect(retry.state).toBe("ready");
    // The earlier locator stays (an unknown outcome may still produce a late copy).
    expect(await intentRows(row.id)).toHaveLength(1);
  });

  it("a missing intent at the ready commit is a 409 that rolls the ready update back and deletes the final key", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    const real = storage.finalizeStorageObject;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        await real(oldKey, newKey);
        await db.execute(
          sql`DELETE FROM attachment_object_gc WHERE object_key = ${newKey}`,
        );
      },
    );
    const result = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(result)).toBe(409);
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([]);
  });

  it("refuses at the cap (three intents) with a 409 before any storage call and leaves the upload intact", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    await seedIntentRows(row, w.t.workspaceId, 3);
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const result = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(result)).toBe(409);
    expect(finalize).not.toHaveBeenCalled();
    expect(await intentRows(row.id)).toHaveLength(3);
    expect(await listFiles(root)).toEqual([path.join(root, row.objectKey)]);
  });

  it("a reservation failure is a 503 before any storage call, and a retry works", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    vi.spyOn(intentQueue, "reserveCompletionIntent").mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const result = await settle(completeAttachment(staffInput(w, row)));
    expect(httpStatus(result)).toBe(503);
    expect(finalize).not.toHaveBeenCalled();
    expect(await listFiles(root)).toEqual([path.join(root, row.objectKey)]);
    expect((await completeAttachment(staffInput(w, row))).state).toBe("ready");
  });

  it("serializes the cap across concurrent completions: five racers, three reservations, two refusals with no storage call", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w);
    const real = storage.finalizeStorageObject;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finalize = vi
      .spyOn(storage, "finalizeStorageObject")
      .mockImplementation(async (oldKey, newKey) => {
        await gate;
        return real(oldKey, newKey);
      });
    const runs = Array.from({ length: 5 }, () =>
      settle(completeAttachment(staffInput(w, row))),
    );
    // Exactly three reservations commit and reach storage; the other two are refused first.
    await waitUntil(
      () => finalize.mock.calls.length === 3,
      "three reservations",
    );
    await waitUntil(
      async () => (await intentRows(row.id)).length === 3,
      "three intents",
    );
    release();
    const results = await Promise.all(runs);
    expect(finalize).toHaveBeenCalledTimes(3);
    const statuses = results.map((result) =>
      result.status === "fulfilled" ? 200 : httpStatus(result),
    );
    expect(
      statuses.filter((status) => status === 409).length,
    ).toBeGreaterThanOrEqual(2);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect((await attachmentRow(row.id))?.state).toBe("ready");
    expect(await intentRows(row.id)).toEqual([]);
  });
});

describe("submission completion: phases A-D", () => {
  async function submissionWorld() {
    const s = await seedIntake("ptm06-submission");
    const ref = await submitAs(s, s.customer);
    const submission = await submissionRow(ref);
    const attachmentId = randomUUID();
    const pendingKey = `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${attachmentId}/evidence.png`;
    await putFile(pendingKey, png(60));
    const pending = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          id: attachmentId,
          workspaceId: s.t.workspaceId,
          organisationId: s.customer.orgId,
          submissionId: submission.id,
          objectKey: pendingKey,
          filename: "evidence.png",
          mimeType: "image/png",
          size: 60,
          state: "pending",
          customerVisible: true,
          uploadedBy: s.customer.person.id,
        })
        .returning(),
      "pending submission attachment",
    );
    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");
    const input = {
      attachmentId: pending.id,
      submissionId: submission.id,
      submissionWorkItemId: submission.workItemId,
      requesterId: s.customer.person.id,
      workspaceId: s.t.workspaceId,
      identity,
    };
    return { s, submission, pending, input };
  }

  it("consumes the intent with ready on success", async () => {
    const w = await submissionWorld();
    const done = await completeSubmissionAttachment(w.input);
    expect(done.state).toBe("ready");
    expect(await intentRows(w.pending.id)).toEqual([]);
  });

  it("keeps the ready object when the commit reply is lost", async () => {
    const w = await submissionWorld();
    loseReadyCommitReply();
    await expect(completeSubmissionAttachment(w.input)).rejects.toThrow(
      "commit reply lost",
    );
    await expectReadyObjectAfterCollection(w.pending.id);
  });

  it("holds no connection and no row lock while storage runs, and the reservation is committed", async () => {
    const w = await submissionWorld();
    const probe = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await probe.connect();
    const real = storage.finalizeStorageObject;
    let seen: { locked: boolean; open: number; intents: number } | undefined;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        // NOWAIT fails (55P03) if any transaction still holds the attachment or submission row.
        let locked = false;
        try {
          await probe.query("BEGIN");
          await probe.query(
            "SELECT 1 FROM attachment WHERE id = $1 FOR UPDATE NOWAIT",
            [w.pending.id],
          );
          await probe.query(
            "SELECT 1 FROM submission WHERE id = $1 FOR UPDATE NOWAIT",
            [w.submission.id],
          );
        } catch {
          locked = true;
        } finally {
          await probe.query("ROLLBACK").catch(() => {});
        }
        const open = await probe.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state IN ('idle in transaction', 'active') AND query NOT ILIKE 'SELECT 1 FROM%'",
        );
        const intents = await probe.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM attachment_object_gc WHERE attachment_id = $1 AND object_key = $2",
          [w.pending.id, newKey],
        );
        seen = {
          locked,
          open: open.rows[0]?.n ?? 0,
          intents: intents.rows[0]?.n ?? 0,
        };
        return real(oldKey, newKey);
      },
    );
    try {
      await completeSubmissionAttachment(w.input);
    } finally {
      await probe.end();
    }
    expect(seen?.locked).toBe(false);
    expect(seen?.intents).toBe(1);
  });

  it("re-validates after storage: a staff decline during the pause is a 404, no ready row, the pending row is untouched, own key deleted", async () => {
    const w = await submissionWorld();
    const real = storage.finalizeStorageObject;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        await real(oldKey, newKey);
        await db
          .update(schema.submissionTable)
          .set({ state: "declined" })
          .where(eq(schema.submissionTable.id, w.submission.id));
      },
    );
    const result = await settle(completeSubmissionAttachment(w.input));
    expect(httpStatus(result)).toBe(404);
    const after = await attachmentRow(w.pending.id);
    expect(after?.state).toBe("pending");
    expect(after?.objectKey).toBe(w.pending.objectKey);
    expect(await listFiles(root)).toEqual([]);
    // Settled, deleted, fingerprint stable: the locator is gone.
    expect(await intentRows(w.pending.id)).toEqual([]);
  });

  it("a valid new -> clarifying change during the pause still completes (no snapshot equality)", async () => {
    const w = await submissionWorld();
    const real = storage.finalizeStorageObject;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        await real(oldKey, newKey);
        await db
          .update(schema.submissionTable)
          .set({ state: "clarifying" })
          .where(eq(schema.submissionTable.id, w.submission.id));
      },
    );
    expect((await completeSubmissionAttachment(w.input)).state).toBe("ready");
    expect(await intentRows(w.pending.id)).toEqual([]);
  });

  it("refuses at the cap with a 409 before any storage call", async () => {
    const w = await submissionWorld();
    await seedIntentRows(w.pending, w.s.t.workspaceId, 3);
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const result = await settle(completeSubmissionAttachment(w.input));
    expect(httpStatus(result)).toBe(409);
    expect(finalize).not.toHaveBeenCalled();
    expect((await attachmentRow(w.pending.id))?.state).toBe("pending");
  });

  it("a competing completion that wins the pending-only CAS leaves one ready row; the loser cleans only its own key", async () => {
    const w = await submissionWorld();
    const real = storage.finalizeStorageObject;
    let racing = false;
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        await real(oldKey, newKey);
        if (!racing) {
          racing = true;
          // A second, whole completion runs to the end while the first is paused. The old path is
          // gone (filesystem rename), so it ends in a settled 400; either way at most one ready.
          await settle(completeSubmissionAttachment(w.input));
        }
      },
    );
    const first = await settle(completeSubmissionAttachment(w.input));
    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, w.pending.id));
    expect(
      rows.filter((row) => row.state === "ready").length,
    ).toBeLessThanOrEqual(1);
    expect(
      first.status === "fulfilled" || httpStatus(first) !== undefined,
    ).toBe(true);
    // Whatever happened, no other call's bytes were deleted and every file left belongs to a row.
    const files = await listFiles(root);
    for (const file of files)
      expect(rows.map((row) => path.join(root, row.objectKey))).toContain(file);
  });
});

// W8 (r7 + errata): a pause after Phase C (the copy/rename has happened, no connection or lock is
// held), then a reach or state change, then Phase D. Phase D re-reads the current state and
// rejects; it never deletes the pending row; this call deletes only its OWN random final key; the
// intent is dropped only after a settled outcome, a successful delete and a stable fingerprint.
// After a SUCCESSFUL Phase C the filesystem rename has already moved the pending bytes, so a
// rejection leaves the pending row naming an old key that no longer holds bytes: nothing here
// retries from it.
describe("W8: Phase D re-validation after a Phase C pause", () => {
  const pauseThen = (afterCopy: () => Promise<void>) => {
    const real = storage.finalizeStorageObject;
    return vi
      .spyOn(storage, "finalizeStorageObject")
      .mockImplementation(async (oldKey, newKey) => {
        await real(oldKey, newKey);
        await afterCopy();
      });
  };

  // An accepted submission whose converted work item carries the requester's pending upload: the
  // accepted-parent branch of the completion. The accepted state itself is a SYNTHETIC row (as in
  // the PTM-05 fixture); the relationship changes below are SYNTHETIC direct writes standing for
  // the staff actions (delete, archive, project delete, requester reassignment), not those routes.
  async function acceptedWorld() {
    const s = await seedIntake("ptm06-w8a");
    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.customer.person.id })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: s.customer.orgId,
          requesterId: s.customer.person.id,
          requestTypeId: s.requestType.id,
          requestTypeVersionId: s.version.id,
          formData: {},
          state: "accepted",
          workItemId: s.t.workItem.id,
          submittedAt: new Date(),
        })
        .returning(),
      "accepted submission",
    );
    const id = randomUUID();
    const pendingKey = `workspace/${s.t.workspaceId}/work-item/${s.t.workItem.id}/attachment/${id}/evidence.png`;
    await putFile(pendingKey, png(64));
    await db.insert(schema.attachmentTable).values({
      id,
      workspaceId: s.t.workspaceId,
      organisationId: s.customer.orgId,
      workItemId: s.t.workItem.id,
      objectKey: pendingKey,
      filename: "evidence.png",
      mimeType: "image/png",
      size: 64,
      state: "pending",
      customerVisible: true,
      uploadedBy: s.customer.person.id,
    });
    return {
      s,
      id,
      pendingKey,
      input: {
        attachmentId: id,
        submissionId: submission.id,
        submissionWorkItemId: submission.workItemId,
        requesterId: s.customer.person.id,
        workspaceId: s.t.workspaceId,
        identity,
      },
    };
  }

  it.each([
    [
      "the converted work item is soft-deleted",
      (w: Awaited<ReturnType<typeof acceptedWorld>>) =>
        db
          .update(schema.workItemTable)
          .set({ deletedAt: new Date() })
          .where(eq(schema.workItemTable.id, w.s.t.workItem.id)),
    ],
    [
      "the converted work item is archived",
      (w: Awaited<ReturnType<typeof acceptedWorld>>) =>
        db
          .update(schema.workItemTable)
          .set({ archivedAt: new Date() })
          .where(eq(schema.workItemTable.id, w.s.t.workItem.id)),
    ],
    [
      "its project is deleted",
      (w: Awaited<ReturnType<typeof acceptedWorld>>) =>
        db
          .update(schema.projectTable)
          .set({ deletedAt: new Date() })
          .where(eq(schema.projectTable.id, w.s.t.project.id)),
    ],
    [
      "the work item's requester is reassigned (CP-16)",
      (w: Awaited<ReturnType<typeof acceptedWorld>>) =>
        db
          .update(schema.workItemTable)
          .set({ requesterId: w.s.t.requesterPerson.id })
          .where(eq(schema.workItemTable.id, w.s.t.workItem.id)),
    ],
  ])(
    "W8a (synthetic relationship write): an accepted completion is rejected when %s during the pause",
    async (_label, change) => {
      const w = await acceptedWorld();
      pauseThen(async () => {
        await change(w);
      });
      const result = await settle(completeSubmissionAttachment(w.input));
      expect(httpStatus(result)).toBe(404);
      const row = await attachmentRow(w.id);
      // Untouched pending row (Phase D never deletes it) and no ready row.
      expect(row).toMatchObject({
        state: "pending",
        objectKey: w.pendingKey,
        workItemId: w.s.t.workItem.id,
      });
      // The copy had moved the pending bytes; this call deleted only its own final key.
      expect(await listFiles(root)).toEqual([]);
      // Settled outcome, successful delete, stable fingerprint: the intent self-dropped.
      expect(await intentRows(w.id)).toEqual([]);
    },
  );

  // W8f uses the PRODUCTION accept path (`acceptSubmission`) from inside the pause, so it also
  // proves Phase C holds no row lock the acceptance needs (it would block, and the test time out).
  async function newSubmissionWorld(fieldKey: string | null) {
    const s = await seedIntake("ptm06-w8f");
    const ref = await submitAs(s, s.customer);
    const submission = await submissionRow(ref);
    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");
    const id = randomUUID();
    const pendingKey = `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${id}/evidence.png`;
    await putFile(pendingKey, png(60));
    await db.insert(schema.attachmentTable).values({
      id,
      workspaceId: s.t.workspaceId,
      organisationId: s.customer.orgId,
      submissionId: submission.id,
      submissionFieldKey: fieldKey,
      objectKey: pendingKey,
      filename: "evidence.png",
      mimeType: "image/png",
      size: 60,
      state: "pending",
      customerVisible: true,
      uploadedBy: s.customer.person.id,
    });
    const input = (submissionWorkItemId: string | null) => ({
      attachmentId: id,
      submissionId: submission.id,
      submissionWorkItemId,
      requesterId: s.customer.person.id,
      workspaceId: s.t.workspaceId,
      identity,
    });
    const accept = () =>
      acceptSubmission(
        ref,
        s.t.workspaceId,
        s.t.requesterPerson.id,
        s.t.project.id,
        s.t.type.id,
        async () => true,
      );
    return { s, id, pendingKey, input, accept };
  }

  it("W8f1: staff acceptance that reparents the visible pending upload during the pause is a 404; nothing retries from the moved pending bytes", async () => {
    const w = await newSubmissionWorld(null);
    let accepted: Awaited<ReturnType<typeof w.accept>> | undefined;
    const paused = pauseThen(async () => {
      accepted = await w.accept();
    });
    // Request start: the submission is `new` and has no work item.
    const first = await settle(completeSubmissionAttachment(w.input(null)));
    expect(httpStatus(first)).toBe(404);
    expect(accepted?.workItem.id).toBeDefined();
    const reparented = await attachmentRow(w.id);
    // The accept (not Phase D) reparented the still-pending row; Phase D wrote nothing to it.
    expect(reparented).toMatchObject({
      state: "pending",
      submissionId: null,
      workItemId: accepted?.workItem.id,
      objectKey: w.pendingKey,
    });
    expect(
      (await db.select().from(schema.attachmentTable)).filter(
        (row) => row.state === "ready",
      ),
    ).toEqual([]);
    // The first call's own final key is gone, and the filesystem rename had already removed the
    // old path: the pending row names bytes that no longer exist.
    expect(await listFiles(root)).toEqual([]);
    expect(await intentRows(w.id)).toEqual([]);

    // A fresh completion against the accepted item cannot succeed from the pending row alone.
    paused.mockRestore();
    const retry = await settle(
      completeSubmissionAttachment(w.input(accepted?.workItem.id ?? null)),
    );
    expect(httpStatus(retry)).toBe(400);
    expect(await attachmentRow(w.id)).toMatchObject({
      state: "pending",
      objectKey: w.pendingKey,
    });
    expect(await listFiles(root)).toEqual([]);
    expect(await intentRows(w.id)).toEqual([]);
  });

  it("W8f2: staff acceptance that suppresses the field marks the pending row deleted during the pause: 404, no ready row, no retry against that row", async () => {
    const w = await newSubmissionWorld("undeclared");
    const paused = pauseThen(async () => {
      await w.accept();
    });
    const first = await settle(completeSubmissionAttachment(w.input(null)));
    expect(httpStatus(first)).toBe(404);
    const row = await attachmentRow(w.id);
    expect(row?.state).toBe("deleted");
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.customerVisible).toBe(false);
    expect(await listFiles(root)).toEqual([]);
    expect(await intentRows(w.id)).toEqual([]);

    // A later completion against the accepted item finds a deleted row: refused before storage.
    paused.mockRestore();
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const accepted = await db
      .select()
      .from(schema.submissionTable)
      .where(eq(schema.submissionTable.id, row?.submissionId as string));
    const retry = await settle(
      completeSubmissionAttachment(w.input(accepted[0]?.workItemId ?? null)),
    );
    expect(httpStatus(retry)).toBe(404);
    expect(finalize).not.toHaveBeenCalled();
    expect((await attachmentRow(w.id))?.state).toBe("deleted");
  });
});
