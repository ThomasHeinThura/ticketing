/**
 * Issue #28 (attachments), N5 security-review fix (2026-09-28): a regression test for two
 * (or more) concurrent `complete` calls racing on the SAME attachment.
 *
 * Before the fix, `toFinalAttachmentObjectKey` was a pure, deterministic function of the
 * pending key alone, so every concurrent `complete` call for the same attachment derived the
 * IDENTICAL final key -- both `finalizeStorageObject` calls (on S3, both `CopyObject`) wrote
 * to that same destination. Whichever call's own size/magic-byte check failed, or whichever
 * lost the `state = 'pending'` row-update race, then deleted "its own" final object -- but
 * since both calls shared one key, that delete removed whatever was actually AT that key,
 * which could be the OTHER call's already-validated, already-`ready` object. The review
 * reproduced this live on MinIO: 2-3 concurrent `complete` calls, 30/30 runs left a `ready`
 * row with its storage object silently gone.
 *
 * Covers both storage drivers:
 *  - filesystem: the real `filesystem` driver against a real temp directory, same pattern as
 *    `attachment.test.ts`.
 *  - S3: the real `completeAttachment` controller and the real S3 driver code path
 *    (`TASKDESK_STORAGE_DRIVER=s3`), with only the AWS SDK's own network client
 *    (`@aws-sdk/client-s3`) replaced by a tiny in-memory fake -- same approach as
 *    `attachment-s3-finalize-race.test.ts` (no MinIO harness exists in this repository's
 *    test suite).
 *
 * Both suites fire N concurrent `POST /api/attachments/{id}/complete` requests against ONE
 * already-uploaded object and confirm: exactly one succeeds (200), the rest get a real,
 * non-200 error, and -- the actual point of N5 -- the winning object is never deleted:
 * downloading it afterward serves the correct, unmodified bytes, not just "an object exists
 * somewhere".
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state_template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state",
  );
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantProjectRole(creator.id, project.id, [
    "project:read",
    "work_item:read",
  ]);
  const type = await makeWorkItemType(workspace.id);
  await makeDefaultState(workspace.id, project.id);
  return { creator, workspace, project, type };
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Attach me" }),
  });
  return (await created.json()) as { key: string };
}

/** Fires `count` concurrent `POST .../complete` requests and returns their statuses. */
async function raceConcurrentCompletes(
  app: ReturnType<typeof createApp>["app"],
  attachmentId: string,
  count: number,
) {
  const responses = await Promise.all(
    Array.from({ length: count }, () =>
      app.request(`/api/attachments/${attachmentId}/complete`, {
        method: "POST",
      }),
    ),
  );
  return responses.map((r) => r.status);
}

describe("N5 regression (#28, 450-attachments.md round 5): concurrent complete -- filesystem", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

  beforeEach(async () => {
    await resetTestDatabase();
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-attachment-n5-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("exactly one of three concurrent completes wins, and the winning object survives with the correct bytes", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    };

    const uploadResponse = await app.request(presigned.uploadUrl, {
      method: "PUT",
      headers: presigned.uploadHeaders,
      body: PNG_BYTES,
    });
    expect(uploadResponse.status).toBe(204);

    // The race: three requests hit `complete` for the SAME attachment at once.
    const statuses = await raceConcurrentCompletes(
      app,
      presigned.attachmentId,
      3,
    );

    const wins = statuses.filter((status) => status === 200);
    const losses = statuses.filter((status) => status !== 200);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(2);
    // A real error, not a silent pass-through -- either "not found in storage" (lost the
    // filesystem rename race before any row was ever touched) or 409 ("already ready").
    for (const status of losses) {
      expect([400, 409]).toContain(status);
    }

    const [readyRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(readyRow?.state).toBe("ready");

    // The actual point of N5: the winning object must not have been deleted by a loser's
    // own cleanup. Download it and confirm the bytes served are the real, original ones --
    // not merely that SOME object exists at the row's key.
    const downloadResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}`,
      { redirect: "manual" },
    );
    expect(downloadResponse.status).toBe(302);
    const downloadLocation = downloadResponse.headers.get("location") ?? "";
    const servedResponse = await app.request(downloadLocation);
    expect(servedResponse.status).toBe(200);
    const servedBytes = Buffer.from(await servedResponse.arrayBuffer());
    expect(servedBytes.equals(PNG_BYTES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S3 (fake AWS SDK client) -- same in-memory-fake approach as
// attachment-s3-finalize-race.test.ts.
// ---------------------------------------------------------------------------

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

  // A barrier so a test can force the exact interleaving the original N5 bug needed: several
  // concurrent `complete` calls each reading the shared PENDING key via their own
  // `CopyObjectCommand` before ANY of them proceeds to delete that source (real
  // `finalizeAttachmentObject` deletes the source right after its own copy) -- without this,
  // this fake's synchronous command handlers resolve so fast that whichever call reaches
  // `copy` first typically finishes its whole copy-then-delete before a second call's `copy`
  // even runs, which only reproduces a narrower "source already gone" race, never the
  // "two calls both hold a valid copy, then race at the DB" case the review actually found on
  // real S3/MinIO (where genuine network latency gives every concurrent call room to copy
  // before any of them deletes).
  let copyBarrierSize = 0;
  let copyArrivals = 0;
  let copyReleases: Array<() => void> = [];

  function setCopyBarrier(size: number) {
    copyBarrierSize = size;
    copyArrivals = 0;
    copyReleases = [];
  }

  // R6-1 (450-attachments.md round 6): lets a test react to each copy's 1-based arrival
  // order (not identity -- concurrent requests don't have a stable "which one is first")
  // to mutate the pending object BETWEEN two copies, so one racer's own snapshot is valid
  // and the other's is not.
  let onCopyArrival: ((arrival: number) => void) | null = null;
  function setOnCopyArrival(fn: ((arrival: number) => void) | null) {
    onCopyArrival = fn;
  }

  // R6-1: pauses only the invalid final object's byte read so its rejection cleanup cannot
  // reach the database until a concurrent valid complete has committed `ready`.
  let getGate: ((key: string) => Promise<void>) | null = null;
  function setGetGate(fn: ((key: string) => Promise<void>) | null) {
    getGate = fn;
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
    const withoutBucket = copySource.split("/").slice(1).join("/");
    return withoutBucket
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  }

  class FakeS3Client {
    async send(command: FakeCommand): Promise<unknown> {
      const { kind, input } = command;

      if (kind === "head") {
        const key = input.Key as string;
        const obj = fakeStore.get(key);
        if (!obj) {
          const error = new Error("NotFound");
          error.name = "NotFound";
          throw error;
        }
        return { ContentLength: obj.length };
      }

      if (kind === "get") {
        const key = input.Key as string;
        if (getGate) await getGate(key);
        const obj = fakeStore.get(key);
        if (!obj) {
          const error = new Error("NoSuchKey");
          error.name = "NoSuchKey";
          throw error;
        }
        let bytes: Buffer = obj;
        const range = input.Range as string | undefined;
        const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
        if (match) {
          bytes = obj.subarray(Number(match[1]), Number(match[2]) + 1);
        }
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
        // Snapshot the bytes NOW, while the source definitely still exists -- real
        // `CopyObject` reads the source at the instant it runs, same as this.
        const snapshot = Buffer.from(obj);

        copyArrivals += 1;
        onCopyArrival?.(copyArrivals);
        if (copyArrivals <= copyBarrierSize) {
          await new Promise<void>((resolve) => {
            copyReleases.push(resolve);
            if (copyReleases.length === copyBarrierSize) {
              for (const release of copyReleases) release();
              copyReleases = [];
            }
          });
        }

        // Real `CopyObject` semantics: an independent snapshot at a NEW key -- the source
        // is untouched by this call (matches `s3.ts` deleting it in a separate, later call).
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

  return {
    fakeStore,
    fakeCommand,
    FakeS3Client,
    setCopyBarrier,
    setOnCopyArrival,
    setGetGate,
  };
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

describe("N5 regression (#28, 450-attachments.md round 5): concurrent complete -- S3 (fake client)", () => {
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;
  const originalEndpoint = process.env.S3_ENDPOINT;
  const originalBucket = process.env.S3_BUCKET;
  const originalAccessKeyId = process.env.S3_ACCESS_KEY_ID;
  const originalSecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const originalKeyPrefix = process.env.S3_KEY_PREFIX;

  beforeEach(async () => {
    await resetTestDatabase();
    s3Fakes.fakeStore.clear();
    s3Fakes.setCopyBarrier(0);
    s3Fakes.setOnCopyArrival(null);
    s3Fakes.setGetGate(null);
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://fake-s3.example.test";
    process.env.S3_BUCKET = "taskdesk-test";
    process.env.S3_ACCESS_KEY_ID = "fake-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "fake-secret-key";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    const restore = (envKey: string, value: string | undefined) => {
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    };
    restore("TASKDESK_STORAGE_DRIVER", originalDriver);
    restore("S3_ENDPOINT", originalEndpoint);
    restore("S3_BUCKET", originalBucket);
    restore("S3_ACCESS_KEY_ID", originalAccessKeyId);
    restore("S3_SECRET_ACCESS_KEY", originalSecretAccessKey);
    restore("S3_KEY_PREFIX", originalKeyPrefix);
  });

  it("exactly one of three concurrent completes wins, and the winning object survives with the correct bytes", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
    };

    const [pendingRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(pendingRow?.state).toBe("pending");
    const pendingKey = pendingRow?.objectKey as string;

    // Model the browser's real PUT to the (faked) presigned URL by seeding the fake
    // in-memory bucket directly, exactly like attachment-s3-finalize-race.test.ts does.
    s3Fakes.fakeStore.set(pendingKey, PNG_BYTES);

    // Force the exact interleaving the original bug needed: all three concurrent calls'
    // `CopyObjectCommand`s read the shared pending key and hold their own independent copy
    // BEFORE any of them proceeds to delete that source -- reproducing the real-S3 timing
    // (genuine network latency between the copy and the delete) that the review's live MinIO
    // repro relied on, not just "whichever call happens to run first finishes entirely before
    // a second one starts".
    s3Fakes.setCopyBarrier(3);

    const statuses = await raceConcurrentCompletes(
      app,
      presigned.attachmentId,
      3,
    );

    const wins = statuses.filter((status) => status === 200);
    const losses = statuses.filter((status) => status !== 200);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(2);
    // With the copy barrier above, all three calls' own `CopyObject`s succeeded onto their
    // own DISTINCT final keys before any delete ran -- exactly the original bug's scenario.
    // With unique keys, the real decisive race is now the `state = 'pending'` guarded UPDATE
    // in `complete-attachment.ts`, so every loser gets the existing "already ready" 409 --
    // never a silent second "success", and (checked below) never the winner's object either.
    for (const status of losses) {
      expect(status).toBe(409);
    }

    const [readyRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(readyRow?.state).toBe("ready");
    const finalKey = readyRow?.objectKey as string;

    // The actual point of N5: the winner's object must still be there, with the right
    // bytes -- not deleted by a loser's own cleanup racing on what used to be the same key.
    const survivingObject = s3Fakes.fakeStore.get(finalKey);
    expect(survivingObject).toBeDefined();
    expect(survivingObject?.equals(PNG_BYTES)).toBe(true);
  });

  it("R6-1 (450-attachments.md round 6): a losing complete's own magic-byte-failure cleanup cannot delete a row a concurrent complete already marked ready", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    const presignResponse = await app.request(
      `/api/work-items/${key}/attachments/presign`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "photo.png",
          contentType: "image/png",
          size: PNG_BYTES.length,
        }),
      },
    );
    expect(presignResponse.status).toBe(200);
    const presigned = (await presignResponse.json()) as {
      attachmentId: string;
    };

    const [pendingRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    const pendingKey = pendingRow?.objectKey as string;
    s3Fakes.fakeStore.set(pendingKey, PNG_BYTES);

    const INVALID_BYTES = Buffer.from("not a png, just plain bytes");

    // Let copy #1 (whichever physical request arrives first -- identity doesn't matter)
    // snapshot the real PNG bytes, then swap the pending object to garbage before copy #2
    // takes its own snapshot: one racer's magic-byte check will pass, the other's won't.
    s3Fakes.setCopyBarrier(2);
    s3Fakes.setOnCopyArrival((arrival) => {
      if (arrival === 1) {
        s3Fakes.fakeStore.set(pendingKey, INVALID_BYTES);
      }
    });

    // Force the real ordering the guard exists for: the invalid request cannot begin its
    // rejection cleanup until the valid request has committed `ready`. Gate the invalid
    // object's read, not its later storage delete, because row cleanup happens first.
    s3Fakes.setGetGate(async (key) => {
      if (!s3Fakes.fakeStore.get(key)?.equals(INVALID_BYTES)) return;

      for (let attempt = 0; attempt < 200; attempt++) {
        const [row] = await db
          .select()
          .from(schema.attachmentTable)
          .where(eq(schema.attachmentTable.id, presigned.attachmentId));
        if (row?.state === "ready") return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Valid concurrent complete did not mark the row ready");
    });

    const statuses = await raceConcurrentCompletes(
      app,
      presigned.attachmentId,
      2,
    );

    const wins = statuses.filter((status) => status === 200);
    const losses = statuses.filter((status) => status !== 200);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    // A real magic-byte rejection, not a race-lost 409 -- this racer's own bytes were bad.
    expect(losses[0]).toBe(400);

    // The actual point of R6-1: the loser's guarded delete found the row no longer
    // `pending` (the winner had already committed) and left it alone.
    const [readyRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(readyRow?.state).toBe("ready");
    const finalKey = readyRow?.objectKey as string;
    const survivingObject = s3Fakes.fakeStore.get(finalKey);
    expect(survivingObject).toBeDefined();
    expect(survivingObject?.equals(PNG_BYTES)).toBe(true);
  });
});
