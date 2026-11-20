/**
 * PTM-05 witnesses on real PostgreSQL (waits are observed in `pg_stat_activity`, never slept):
 * a distinct-row quota race, accepted/resolved S3 two-copy races through both completion routes
 * (valid/valid and valid/invalid; no `40P01`), and the failure/denial matrix. Cleanup is best
 * effort: a failed or lost delete still orphans bytes.
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAttachment } from "../../apps/api/src/attachment/controllers/complete-attachment";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import * as attachmentRepository from "../../apps/api/src/attachment/repository";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as storage from "../../apps/api/src/storage";
import { buildTenant, json, type Tenant } from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { seedIntake } from "./helpers/intake-http";

// Same hoisting/resolution approach as `attachment-s3-finalize-race.test.ts`: only the AWS SDK
// network client is replaced; the real S3 driver code, controllers and PostgreSQL are under test.
const resolvedAwsPaths = vi.hoisted(() => {
  const nodeModule = process.getBuiltinModule("node:module");
  const nodePath = process.getBuiltinModule("node:path");
  const apiS3Path = nodePath.resolve(
    import.meta.dirname,
    "../../apps/api/src/storage/s3.ts",
  );
  const apiRequire = nodeModule.createRequire(apiS3Path);
  return {
    clientS3: apiRequire.resolve("@aws-sdk/client-s3"),
    presigner: apiRequire.resolve("@aws-sdk/s3-request-presigner"),
  };
});

const s3Fakes = vi.hoisted(() => {
  type FakeCommand = { kind: string; input: Record<string, unknown> };
  const fakeStore = new Map<string, Buffer>();
  // One-shot gate: the first CopyObject takes its source snapshot, signals `reached`, then waits
  // for `release()` before publishing the destination (a copy still in flight on the server).
  const gate = {
    armed: false,
    reached: Promise.resolve(),
    signalReached: () => {},
    released: Promise.resolve(),
    release: () => {},
  };

  function arm() {
    gate.armed = true;
    gate.reached = new Promise<void>((resolve) => {
      gate.signalReached = resolve;
    });
    gate.released = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
  }

  function fakeCommand(kind: string) {
    return class {
      kind = kind;
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    };
  }

  function decodeCopySourceKey(copySource: string): string {
    return copySource
      .split("/")
      .slice(1)
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  }

  class FakeS3Client {
    async send(command: FakeCommand): Promise<unknown> {
      const { kind, input } = command;
      if (kind === "head") {
        const obj = fakeStore.get(input.Key as string);
        if (!obj) {
          const error = new Error("NotFound");
          error.name = "NotFound";
          throw error;
        }
        return { ContentLength: obj.length };
      }
      if (kind === "get") {
        const obj = fakeStore.get(input.Key as string);
        if (!obj) {
          const error = new Error("NoSuchKey");
          error.name = "NoSuchKey";
          throw error;
        }
        const range = input.Range as string | undefined;
        const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
        const bytes = match
          ? obj.subarray(Number(match[1]), Number(match[2]) + 1)
          : obj;
        return {
          Body: { transformToByteArray: async () => new Uint8Array(bytes) },
        };
      }
      if (kind === "copy") {
        const sourceKey = decodeCopySourceKey(input.CopySource as string);
        const obj = fakeStore.get(sourceKey);
        if (!obj) {
          const error = new Error("NoSuchKey");
          error.name = "NoSuchKey";
          throw error;
        }
        const snapshot = Buffer.from(obj);
        if (gate.armed) {
          gate.armed = false;
          gate.signalReached();
          await gate.released;
        }
        fakeStore.set(input.Key as string, snapshot);
        return {};
      }
      if (kind === "delete") {
        fakeStore.delete(input.Key as string);
        return {};
      }
      throw new Error(`FakeS3Client: unhandled command kind "${kind}"`);
    }
  }

  return { fakeStore, fakeCommand, FakeS3Client, gate, arm };
});

vi.mock(resolvedAwsPaths.clientS3, () => ({
  S3Client: s3Fakes.FakeS3Client,
  HeadObjectCommand: s3Fakes.fakeCommand("head"),
  GetObjectCommand: s3Fakes.fakeCommand("get"),
  CopyObjectCommand: s3Fakes.fakeCommand("copy"),
  DeleteObjectCommand: s3Fakes.fakeCommand("delete"),
  PutObjectCommand: s3Fakes.fakeCommand("put"),
}));
vi.mock(resolvedAwsPaths.presigner, () => ({
  getSignedUrl: async () => "https://fake-s3.example.test/presigned-put",
}));

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const png = (bytes: number) =>
  Buffer.concat([PNG_HEADER, Buffer.alloc(bytes - PNG_HEADER.length, 7)]);

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

/** Attaches handlers immediately, so a rejection is never unhandled while the test waits. */
function settle<T>(operation: Promise<T>): Promise<Settled<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

function httpStatus(result: Settled<unknown>) {
  return result.status === "rejected" && result.reason instanceof HTTPException
    ? result.reason.status
    : undefined;
}

function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function waitUntil(
  condition: () => Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function rawClient() {
  return new Client({ connectionString: process.env.TASKDESK_DATABASE_URL });
}

/** Backends waiting on a lock the given backend holds (observed, not assumed). */
async function backendsBlockedBy(client: Client, ownerPid: number) {
  await client.query("SELECT pg_stat_clear_snapshot()");
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
    [ownerPid],
  );
  return result.rows[0]?.n ?? 0;
}

/** Backends waiting on a lock inside a statement that starts with `prefix`. */
async function statementsWaiting(client: Client, prefix: string) {
  await client.query("SELECT pg_stat_clear_snapshot()");
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query ILIKE $1`,
    [`${prefix}%`],
  );
  return result.rows[0]?.n ?? 0;
}

/** Every started operation, so a failed wait can still drain them before the next DB reset. */
function startedOperations() {
  const started: Promise<Settled<unknown>>[] = [];
  return {
    run<T>(operation: Promise<T>) {
      const settled = settle(operation);
      started.push(settled);
      return settled;
    },
    drain: () => Promise.all(started),
  };
}

/** Bounded wait for the held copy that also stops if the submission settles first. */
async function waitForHeldCopy(
  reached: Promise<void>,
  submission: Promise<Settled<unknown>>,
  timeoutMs = 10_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    reached.then(() => "held" as const),
    submission.then(() => "settled" as const),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (outcome !== "held") throw new Error(`copy was not held: ${outcome}`);
}

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

async function setQuota(workspaceId: string, maxBytes: number) {
  const [workspace] = await db
    .select({ organisationId: schema.workspaceTable.organisationId })
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, workspaceId));
  await db
    .insert(schema.organisationQuotaTable)
    .values({
      organisationId: workspace?.organisationId as string,
      maxStorageBytes: maxBytes,
    })
    .onConflictDoUpdate({
      target: schema.organisationQuotaTable.organisationId,
      set: { maxStorageBytes: maxBytes },
    });
}

async function staffWorld() {
  const t = await buildTenant("ptm05");
  const identity = await resolveIdentity({
    userId: t.requester.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("failed to resolve staff identity");
  return { t, identity };
}
type StaffWorld = Awaited<ReturnType<typeof staffWorld>>;

async function secondWorkItem(t: Tenant) {
  mockAuthenticatedSession(t.requester.user);
  const created = await t.app.request(
    `/api/projects/${t.project.id}/work-items`,
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({ typeId: t.type.id, title: "Second item" }),
    },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  return (await created.json()) as { id: string; key: string };
}

/** A pending staff row the way presign would insert it (declared size, no uploader). */
async function pendingStaffRow(
  t: Tenant,
  workItemId: string,
  declaredSize: number,
) {
  const id = randomUUID();
  const objectKey = `workspace/${t.workspaceId}/work-item/${workItemId}/attachment/${id}/photo.png`;
  const row = requireRow(
    await db
      .insert(schema.attachmentTable)
      .values({
        id,
        workspaceId: t.workspaceId,
        workItemId,
        objectKey,
        filename: "photo.png",
        mimeType: "image/png",
        size: declaredSize,
        state: "pending",
        customerVisible: false,
      })
      .returning(),
    "pending staff attachment",
  );
  return row;
}

const staffInput = (
  w: StaffWorld,
  row: { id: string },
  workItemId: string,
  overrides: Partial<Parameters<typeof completeAttachment>[0]> = {},
) => ({
  attachmentId: row.id,
  workspaceId: w.t.workspaceId,
  workItemId,
  actorId: w.t.requester.user.id,
  actorType: "person" as const,
  identity: w.identity,
  ...overrides,
});

const attachmentRow = (id: string) =>
  db.query.attachmentTable.findFirst({
    where: eq(schema.attachmentTable.id, id),
  });

const addedActivity = async () =>
  db
    .select()
    .from(schema.activityTable)
    .where(eq(schema.activityTable.verb, "attachment.added"));

describe("PTM-05 complete: quota in the ready transaction, own-key cleanup (filesystem)", () => {
  let root: string;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  const putPending = async (key: string, bytes: Buffer) => {
    const file = path.join(root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  };

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-ptm05-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalRoot === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    if (originalDriver === undefined)
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
      delete process.env.TASKDESK_STORAGE_DRIVER;
    else process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
    await rm(root, { recursive: true, force: true });
  });

  it("two distinct rows with larger actual sizes cannot both pass one organisation quota", async () => {
    const w = await staffWorld();
    const second = await secondWorkItem(w.t);
    await setQuota(w.t.workspaceId, 100);
    const items = [w.t.workItem.id, second.id];
    const rows = [];
    for (const itemId of items) {
      // Declared 10 bytes (what presign counted), really 60.
      const row = await pendingStaffRow(w.t, itemId, 10);
      await putPending(row.objectKey, png(60));
      rows.push(row);
    }

    const holder = rawClient();
    await holder.connect();
    const started = startedOperations();
    let open = false;
    let runs: Promise<Settled<unknown>>[] = [];
    try {
      await holder.query("BEGIN");
      open = true;
      await holder.query(
        "SELECT id FROM work_item WHERE id = ANY($1) ORDER BY id FOR UPDATE",
        [items],
      );
      const pid = (
        await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]?.pid as number;
      runs = rows.map((row, index) =>
        started.run(
          completeAttachment(staffInput(w, row, items[index] as string)),
        ),
      );
      await waitUntil(
        async () => (await backendsBlockedBy(holder, pid)) === 2,
        "both completions to block on their work item rows",
      );
      await holder.query("COMMIT");
      open = false;
    } finally {
      // Release the blockers first, then leave no writer running into the next DB reset.
      if (open) await holder.query("ROLLBACK").catch(() => {});
      await holder.end();
      await started.drain();
    }
    const results = await Promise.all(runs);

    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r) => r.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers.map(httpStatus)).toEqual([429]);

    const winnerId = (winners[0] as { value: { id: string } }).value.id;
    const loserRow = rows.find((row) => row.id !== winnerId);
    const winnerRow = await attachmentRow(winnerId);
    expect(winnerRow?.state).toBe("ready");
    expect(winnerRow?.size).toBe(60);
    // The loser's pending row and object are gone, and the organisation is within its limit.
    expect(await attachmentRow(loserRow?.id as string)).toBeUndefined();
    const usage = await attachmentRepository.readOrganisationStorageUsage(db, {
      workspaceId: w.t.workspaceId,
    });
    expect(usage?.usedBytes).toBe(60);
    expect(usage?.usedBytes).toBeLessThanOrEqual(usage?.maxStorageBytes ?? 0);
    // Exactly the winner's final object remains, with its original bytes.
    const files = await listFiles(root);
    expect(files).toEqual([path.join(root, winnerRow?.objectKey as string)]);
    expect(
      (await storage.getObjectSizeAndHeader(winnerRow?.objectKey as string, 8))
        .contentLength,
    ).toBe(60);
    const added = await addedActivity();
    expect(added).toHaveLength(1);
    expect(
      added.map(
        (row) => (row.payload as { attachmentId: string }).attachmentId,
      ),
    ).toEqual([winnerId]);
  });

  it("an oversize object is rejected, its row and object removed", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    vi.spyOn(attachmentRepository, "getAttachmentSizeLimit").mockResolvedValue([
      { maxBytes: 50 },
    ] as never);
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(400);
    expect(await attachmentRow(row.id)).toBeUndefined();
    expect(await listFiles(root)).toEqual([]);
    expect(await addedActivity()).toEqual([]);
  });

  it("content that does not match the declared type is rejected, its row and object removed", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, Buffer.from("not an image at all"));
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(400);
    expect(await attachmentRow(row.id)).toBeUndefined();
    expect(await listFiles(root)).toEqual([]);
  });

  it("an over-quota upload is a 429 that removes the pending row and the object", async () => {
    const w = await staffWorld();
    await setQuota(w.t.workspaceId, 50);
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(429);
    expect(await attachmentRow(row.id)).toBeUndefined();
    expect(await listFiles(root)).toEqual([]);
    expect(await addedActivity()).toEqual([]);
  });

  it("a transient quota error keeps the pending row, removes the object and writes no activity", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    vi.spyOn(
      attachmentRepository,
      "readOrganisationStorageUsage",
    ).mockRejectedValueOnce(new Error("quota read failed"));
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(result.status).toBe("rejected");
    expect((result as { reason: Error }).reason.message).toBe(
      "quota read failed",
    );
    const after = await attachmentRow(row.id);
    expect(after?.state).toBe("pending");
    expect(after?.objectKey).toBe(row.objectKey);
    expect(await listFiles(root)).toEqual([]);
    expect(await addedActivity()).toEqual([]);
  });

  it("a failed pending-row cleanup after a 429 still reports the 429 and removes the object", async () => {
    const w = await staffWorld();
    await setQuota(w.t.workspaceId, 50);
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    vi.spyOn(
      attachmentRepository,
      "deletePendingWorkItemAttachment",
    ).mockRejectedValueOnce(new Error("row cleanup failed"));
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(429);
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([]);
  });

  it("a post-finalize HEAD failure is a 400 that removes the object and keeps the pending row", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    vi.spyOn(storage, "getObjectSizeAndHeader").mockRejectedValueOnce(
      new Error("head failed"),
    );
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(400);
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([]);
  });

  it("a failed object delete never replaces the original error (best-effort limit: the object stays)", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    vi.spyOn(storage, "getObjectSizeAndHeader").mockRejectedValueOnce(
      new Error("head failed"),
    );
    const deleteSpy = vi
      .spyOn(storage, "deleteStorageObject")
      .mockRejectedValue(new Error("delete failed"));
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(400);
    expect(deleteSpy).toHaveBeenCalledOnce();
    // Documented interim: the delete failed, so the finalized bytes are still on disk.
    expect(await listFiles(root)).toHaveLength(1);
  });

  it("an archive landing between finalize and ready is a 404 that removes the object and keeps the row pending", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    const realRead = storage.getObjectSizeAndHeader;
    vi.spyOn(storage, "getObjectSizeAndHeader").mockImplementationOnce(
      async (...args) => {
        const read = await realRead(...args);
        await db
          .update(schema.workItemTable)
          .set({ archivedAt: new Date() })
          .where(eq(schema.workItemTable.id, w.t.workItem.id));
        return read;
      },
    );
    const result = await settle(
      completeAttachment(staffInput(w, row, w.t.workItem.id)),
    );
    expect(httpStatus(result)).toBe(404);
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([]);
    expect(await addedActivity()).toEqual([]);
  });

  it("a malformed workspace is denied before any finalize and leaves the upload untouched", async () => {
    const w = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const result = await settle(
      completeAttachment(
        staffInput(w, row, w.t.workItem.id, {
          workspaceId: `other-${randomUUID()}`,
        }),
      ),
    );
    expect(httpStatus(result)).toBe(404);
    expect(finalize).not.toHaveBeenCalled();
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([path.join(root, row.objectKey)]);
  });

  it("a real second tenant is denied against the original workspace and item before any finalize", async () => {
    const w = await staffWorld();
    const other = await staffWorld();
    const row = await pendingStaffRow(w.t, w.t.workItem.id, 10);
    await putPending(row.objectKey, png(60));
    const finalize = vi.spyOn(storage, "finalizeStorageObject");
    const result = await settle(
      completeAttachment(
        staffInput(w, row, w.t.workItem.id, {
          identity: other.identity,
          actorId: other.t.requester.user.id,
        }),
      ),
    );
    expect(httpStatus(result)).toBe(404);
    expect(finalize).not.toHaveBeenCalled();
    expect((await attachmentRow(row.id))?.state).toBe("pending");
    expect(await listFiles(root)).toEqual([path.join(root, row.objectKey)]);
    expect(await addedActivity()).toEqual([]);
  });

  it("the portal route also removes its row and object on a 429", async () => {
    const s = await seedIntake("ptm05-portal");
    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.customer.person.id })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    await setQuota(s.t.workspaceId, 50);
    const id = randomUUID();
    const objectKey = `workspace/${s.t.workspaceId}/work-item/${s.t.workItem.id}/attachment/${id}/evidence.png`;
    await db.insert(schema.attachmentTable).values({
      id,
      workspaceId: s.t.workspaceId,
      organisationId: s.customer.orgId,
      workItemId: s.t.workItem.id,
      objectKey,
      filename: "evidence.png",
      mimeType: "image/png",
      size: 10,
      state: "pending",
      customerVisible: true,
      uploadedBy: s.customer.person.id,
    });
    await putPending(objectKey, png(60));
    const result = await settle(
      completeAttachment({
        attachmentId: id,
        workspaceId: s.t.workspaceId,
        workItemId: s.t.workItem.id,
        actorId: s.customer.user.id,
        actorType: "person",
        identity,
        portal: true,
      }),
    );
    expect(httpStatus(result)).toBe(429);
    expect(await attachmentRow(id)).toBeUndefined();
    expect(await listFiles(root)).toEqual([]);
  });
});

describe("PTM-05 complete: accepted, resolved request completed through both routes (S3 two copies)", () => {
  const envKeys = [
    "TASKDESK_STORAGE_DRIVER",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_KEY_PREFIX",
  ] as const;
  const original = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(async () => {
    await resetTestDatabase();
    s3Fakes.fakeStore.clear();
    s3Fakes.gate.armed = false;
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://fake-s3.example.test";
    process.env.S3_BUCKET = "taskdesk-test";
    process.env.S3_ACCESS_KEY_ID = "fake-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "fake-secret-key";
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test configures storage for itself.
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    s3Fakes.gate.release();
    for (const key of envKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function seedAcceptedResolvedUpload() {
    const s = await seedIntake("ptm05-s3-two-copy");
    const identity = await resolveIdentity({
      userId: s.customer.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("failed to resolve customer identity");
    // An accepted submission whose converted work item is resolved and still the requester's.
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.customer.person.id, resolvedAt: new Date() })
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
    return { s, identity, submission, id, pendingKey };
  }

  // The submission route copies the valid object and is held mid-copy while it owns the
  // attachment row; the portal route then copies whatever is at the pending key and queues on
  // that row (its ready UPDATE, or its reject DELETE when the second object is invalid).
  it.each([
    {
      name: "valid then valid",
      second: null,
      queuedOn: 'update "attachment"',
      ordinaryStatus: 409,
    },
    {
      name: "valid then invalid",
      second: Buffer.from("not an image at all"),
      queuedOn: 'delete from "attachment"',
      ordinaryStatus: 400,
    },
  ])(
    "completes exactly once with no deadlock and the winner's bytes intact ($name)",
    async ({ second, queuedOn, ordinaryStatus }) => {
      const { s, identity, submission, id, pendingKey } =
        await seedAcceptedResolvedUpload();
      const bytes = png(64);
      s3Fakes.fakeStore.set(pendingKey, bytes);

      const started = startedOperations();
      const observer = rawClient();
      await observer.connect();
      let submissionRun: Promise<Settled<unknown>> | undefined;
      let ordinaryRun: Promise<Settled<unknown>> | undefined;
      try {
        s3Fakes.arm();
        submissionRun = started.run(
          completeSubmissionAttachment({
            attachmentId: id,
            submissionId: submission.id,
            submissionWorkItemId: submission.workItemId,
            requesterId: s.customer.person.id,
            workspaceId: s.t.workspaceId,
            identity,
          }),
        );
        await waitForHeldCopy(s3Fakes.gate.reached, submissionRun);
        // The held copy already snapshotted the valid bytes; replace what a later copy sees.
        if (second) s3Fakes.fakeStore.set(pendingKey, second);
        ordinaryRun = started.run(
          completeAttachment({
            attachmentId: id,
            workspaceId: s.t.workspaceId,
            workItemId: s.t.workItem.id,
            actorId: s.customer.user.id,
            actorType: "person",
            identity,
            portal: true,
          }),
        );
        await waitUntil(
          async () => (await statementsWaiting(observer, queuedOn)) >= 1,
          `the portal completion to queue on the attachment row (${queuedOn})`,
        );
      } finally {
        // Release the held copy first, then leave no writer running into the next DB reset.
        s3Fakes.gate.release();
        await observer.end();
        await started.drain();
      }
      const submissionResult = (await submissionRun) as Settled<unknown>;
      const ordinaryResult = (await ordinaryRun) as Settled<unknown>;

      for (const result of [submissionResult, ordinaryResult]) {
        if (result.status === "rejected")
          expect(pgCode(result.reason)).not.toBe("40P01");
      }
      expect(submissionResult.status).toBe("fulfilled");
      expect(httpStatus(ordinaryResult)).toBe(ordinaryStatus);

      const ready = await attachmentRow(id);
      expect(ready?.state).toBe("ready");
      const finalKey = ready?.objectKey as string;
      expect(finalKey).not.toBe(pendingKey);
      // Only the winner's final object is left, with the validated bytes: the loser removed
      // just its own random final key.
      expect([...s3Fakes.fakeStore.keys()]).toEqual([finalKey]);
      expect(s3Fakes.fakeStore.get(finalKey)?.equals(bytes)).toBe(true);
      const activity = await db
        .select()
        .from(schema.activityTable)
        .where(eq(schema.activityTable.workItemId, s.t.workItem.id));
      expect(activity.filter((a) => a.verb === "attachment.added")).toEqual([]);
      expect(activity.filter((a) => a.verb === "reopen_received")).toHaveLength(
        1,
      );
    },
  );
});
