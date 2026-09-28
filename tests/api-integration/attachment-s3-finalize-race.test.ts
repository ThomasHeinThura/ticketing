/**
 * Issue #28 (attachments), N2 security-review fix (2026-09-27, delta 2): a regression
 * test for the exact TOCTOU the review reproduced on S3/MinIO -- `complete` used to check
 * the object at its PENDING key (HEAD for size, ranged GET for the magic-byte sniff), then
 * run a SEPARATE `CopyObject` of that same pending key to the final key. A PUT landing in
 * the gap between the check and the copy changed what got copied without changing what was
 * checked, so the object marked "ready" could differ from the one actually validated.
 *
 * There is no real S3/MinIO endpoint available in this test environment (this repository
 * deliberately ships no S3 test harness -- `docs/04-engineering/ci-cd.md` names none), so
 * this exercises the real `completeAttachment` controller end to end against the REAL S3
 * driver code path (`TASKDESK_STORAGE_DRIVER=s3`), with only the AWS SDK's own network
 * client (`@aws-sdk/client-s3`) replaced by a tiny in-memory fake -- everything above that
 * (routing, permission checks, the DB transaction, `storage/index.ts`'s driver selection,
 * `storage/s3.ts`'s own call sequencing) is the genuine, unmodified code under test. The
 * fake's `CopyObjectCommand` handling takes an independent `Buffer.from(...)` snapshot,
 * matching real S3 `CopyObject` semantics: once copied, nothing further written to the
 * source key can reach back into the copy.
 *
 * The race itself is injected via a one-shot hook fired the instant the fake's
 * `GetObjectCommand` handler runs (the ranged read `complete` uses for its magic-byte
 * sniff -- the LAST read the review's own gap sits after: "checks the object..., then
 * runs a separate CopyObject"). Firing it there reproduces "a PUT lands in the gap between
 * the check and the copy" precisely: under the old (checked-then-copied) order this
 * mutates the PENDING key before the later copy reads it; under the fixed
 * (copied-then-checked) order the copy has already run by the time this fires, so the
 * mutation only ever reaches an already-vacated, already-orphaned pending key.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

// A `vi.mock` factory (and its first-argument path expression) is evaluated at its
// HOISTED position -- above every other top-level statement in this file, including plain
// `const`s and regular `import`s (vitest's own transform rewrites those into
// lazily-initialized bindings that are not live there either). Everything the factory
// needs, including the fake implementation itself, therefore has to come from inside
// `vi.hoisted(...)` calls rather than from ordinary module-scope declarations below --
// `s3Fakes` is exposed back out so the rest of this file (test bodies) can drive the same
// in-memory store and race hook the factory closes over.
const resolvedAwsPaths = vi.hoisted(() => {
  // `process.getBuiltinModule`/`import.meta.dirname` (not `import`s) for the same hoisting
  // reason -- see above.
  //
  // `vi.mock("@aws-sdk/client-s3", ...)` alone would not intercept
  // `apps/api/src/storage/s3.ts`'s own import of it: this test file lives under `tests/`,
  // outside the `apps/api` package, so resolving the bare specifier from *this* file's
  // location finds nothing (there is no hoisted top-level copy -- pnpm keeps it only under
  // `apps/api/node_modules`), and the mock would silently register for a module id `s3.ts`
  // never actually resolves to, leaving its real import (and a real network call)
  // untouched. Resolving the exact same absolute path `s3.ts` itself would get -- via a
  // `require` scoped to a file inside `apps/api` -- targets the real resolved module id
  // instead.
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
  let raceHook: (() => void) | null = null;

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
    // s3.ts's own `encodeCopySourceKey`: `${bucket}/${encodeURIComponent-per-segment(key)}`.
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
        // Fire (once) exactly where the review's own gap sits: right after the check has
        // read its bytes, before the later, separate CopyObject call runs.
        const hook = raceHook;
        raceHook = null;
        hook?.();
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
        // Real `CopyObject` semantics: an independent snapshot, not a reference -- nothing
        // written to the source afterwards can reach back into this copy.
        fakeStore.set(input.Key as string, Buffer.from(obj));
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
    setRaceHook: (hook: (() => void) | null) => {
      raceHook = hook;
    },
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

// `getSignedUrl` needs the real `S3Client`'s internals (config resolution, middleware
// stack) to compute a real SigV4 signature -- the fake client above only implements
// `.send()`. This test never actually PUTs through the presigned URL anyway (the
// browser's real PUT to S3 happens entirely outside this process; see the class-level
// comment) -- `presignAttachment` only needs to succeed so a real `pending` row gets
// inserted through the genuine route, so the URL itself is stubbed rather than faked out
// further.
vi.mock(resolvedAwsPaths.presigner, () => ({
  getSignedUrl: async () => "https://fake-s3.example.test/presigned-put",
}));

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const MALICIOUS_PE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

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

describe("N2 regression (#28, 450-attachments.md delta 2): S3 finalize-then-check ordering", () => {
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;
  const originalEndpoint = process.env.S3_ENDPOINT;
  const originalBucket = process.env.S3_BUCKET;
  const originalAccessKeyId = process.env.S3_ACCESS_KEY_ID;
  const originalSecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const originalKeyPrefix = process.env.S3_KEY_PREFIX;

  beforeEach(async () => {
    await resetTestDatabase();
    s3Fakes.fakeStore.clear();
    s3Fakes.setRaceHook(null);
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://fake-s3.example.test";
    process.env.S3_BUCKET = "taskdesk-test";
    process.env.S3_ACCESS_KEY_ID = "fake-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "fake-secret-key";
    delete process.env.S3_KEY_PREFIX;
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("TASKDESK_STORAGE_DRIVER", originalDriver);
    restore("S3_ENDPOINT", originalEndpoint);
    restore("S3_BUCKET", originalBucket);
    restore("S3_ACCESS_KEY_ID", originalAccessKeyId);
    restore("S3_SECRET_ACCESS_KEY", originalSecretAccessKey);
    restore("S3_KEY_PREFIX", originalKeyPrefix);
  });

  it("a PUT racing the gap between the magic-byte check and the finalize copy cannot change what gets served as ready", async () => {
    const { creator, project, type } = await setupProject();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const { key } = await createWorkItem(app, project.id, type.id);

    // Insert the pending row exactly the way `presignAttachment` would -- the browser's
    // PUT to the real presigned URL happens entirely outside this process, so it is
    // modeled here as directly seeding the fake in-memory "bucket" with the bytes
    // `complete` is about to check.
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

    s3Fakes.fakeStore.set(pendingKey, PNG_BYTES);

    // The exact race: as soon as `complete`'s magic-byte check reads the pending key, a
    // PUT (a replay of the still-valid presigned URL, or the review's actual racing PUT)
    // lands and replaces it -- BEFORE the finalize step runs.
    s3Fakes.setRaceHook(() => {
      s3Fakes.fakeStore.set(pendingKey, MALICIOUS_PE_HEADER);
    });

    const completeResponse = await app.request(
      `/api/attachments/${presigned.attachmentId}/complete`,
      { method: "POST" },
    );
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as { state: string };
    expect(completed.state).toBe("ready");

    const [readyRow] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, presigned.attachmentId));
    expect(readyRow?.state).toBe("ready");
    const finalKey = readyRow?.objectKey as string;
    expect(finalKey).not.toBe(pendingKey);

    // The proof: what actually got copied, checked and is now served as "ready" is still
    // the ORIGINAL PNG bytes -- never the bytes the race slipped in.
    expect(s3Fakes.fakeStore.get(finalKey)?.equals(PNG_BYTES)).toBe(true);
    expect(s3Fakes.fakeStore.get(finalKey)?.equals(MALICIOUS_PE_HEADER)).toBe(
      false,
    );

    // The race still landed somewhere -- an orphan at the vacated pending key (the
    // accepted, non-blocking N4 finding) -- just never on the object actually served.
    expect(s3Fakes.fakeStore.get(pendingKey)?.equals(MALICIOUS_PE_HEADER)).toBe(
      true,
    );
  });
});
