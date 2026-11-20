/**
 * PTM-06 pool and cross-route witnesses (W5/W9, K=3 shared reservation) on a fresh, dedicated
 * `_test` PostgreSQL database, filesystem driver. Test-only: production code is not changed.
 *
 *  - Ten concurrent submission completions run on the REAL application pool (`max: 10`). The pool
 *    is instrumented at `pool.connect` (the single entry for `pool.query` and for transactions)
 *    with the request id carried by AsyncLocalStorage, so "held connections" is MEASURED per
 *    request rather than inferred from the requests finishing.
 *  - While every request is inside Phase A all ten connections are checked out (pool exhausted);
 *    the requests must still finish: a second, nested acquisition (the pre-PTM-06 design) would
 *    starve here.
 *  - While every request is inside storage I/O (Phase C) the pool, the row locks and the advisory
 *    locks are observed from a separate raw connection: nothing is held.
 *  - The shared K=3 reservation is exercised through BOTH routes on the one fixture where a single
 *    attachment row is reachable by both: an accepted submission whose converted, live work item
 *    carries the requester's pending upload (the PTM-05 admissible arrangement).
 * Gates are always released in `finally`; every wait is bounded.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { Client, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeAttachment } from "../../apps/api/src/attachment/controllers/complete-attachment";
import { completeSubmissionAttachment } from "../../apps/api/src/attachment/controllers/complete-submission-attachment";
import * as attachmentRepository from "../../apps/api/src/attachment/repository";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as storage from "../../apps/api/src/storage";
import { resetTestDatabase } from "./helpers/database";
import { seedIntake } from "./helpers/intake-http";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const png = (bytes: number) =>
  Buffer.concat([PNG_HEADER, Buffer.alloc(bytes - PNG_HEADER.length, 7)]);

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };
const settle = <T>(operation: Promise<T>): Promise<Settled<T>> =>
  operation.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
const httpStatus = (result: Settled<unknown>) =>
  result.status === "rejected" && result.reason instanceof HTTPException
    ? result.reason.status
    : undefined;
const pgCode = (error: unknown): string | undefined => {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};

/** A bounded wait: rejects instead of hanging the file. */
async function within<T>(promise: Promise<T>, label: string, ms = 20_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Holds `parties` arrivals until `open()`; `full` resolves when the last one has arrived. */
function barrier(parties: number) {
  let arrived = 0;
  let open: () => void = () => {};
  let complete: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  const full = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    arrive: async () => {
      arrived += 1;
      if (arrived >= parties) complete();
      await opened;
    },
    full,
    open: () => open(),
    arrivals: () => arrived,
  };
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

let root: string;
const savedEnv = { ...process.env };
const rawClient = () =>
  new Client({ connectionString: process.env.TASKDESK_DATABASE_URL });

beforeEach(async () => {
  await resetTestDatabase();
  root = await mkdtemp(path.join(tmpdir(), "taskdesk-ptm06-pool-"));
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  delete process.env.TASKDESK_STORAGE_DRIVER;
  delete process.env.TASKDESK_ROLE;
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  await rm(root, { recursive: true, force: true });
});

/**
 * Measures checkouts at `pool.connect`. Every request runs inside `requests.run({ id }, ...)`, so
 * a checkout is attributed to the request that asked for it. `held` is the number of clients a
 * request has checked out and not yet released; `nested` records a checkout made while that
 * request already held one.
 */
function instrumentPool(requests: AsyncLocalStorage<{ id: number }>) {
  const pool = getDatabasePool();
  const held = new Map<number, number>();
  const stats = {
    checkouts: 0,
    live: 0,
    peakLive: 0,
    peakHeldByOneRequest: 0,
    nested: [] as number[],
  };
  type ConnectCallback = (
    error?: unknown,
    client?: PoolClient,
    done?: unknown,
  ) => void;
  const original = pool.connect.bind(pool) as (
    callback?: ConnectCallback,
  ) => Promise<PoolClient> | undefined;
  const track = (client: PoolClient, owner: number | undefined) => {
    stats.checkouts += 1;
    stats.live += 1;
    stats.peakLive = Math.max(stats.peakLive, stats.live);
    if (owner !== undefined) {
      const now = (held.get(owner) ?? 0) + 1;
      held.set(owner, now);
      stats.peakHeldByOneRequest = Math.max(stats.peakHeldByOneRequest, now);
      if (now > 1) stats.nested.push(owner);
    }
    const release = client.release.bind(client);
    let released = false;
    client.release = ((error?: Error | boolean) => {
      if (!released) {
        released = true;
        stats.live -= 1;
        if (owner !== undefined) held.set(owner, (held.get(owner) ?? 1) - 1);
      }
      return release(error);
    }) as PoolClient["release"];
    return client;
  };
  (pool as unknown as { connect: unknown }).connect = (
    callback?: ConnectCallback,
  ) => {
    const owner = requests.getStore()?.id;
    if (typeof callback === "function")
      return original((error?: unknown, client?: PoolClient) =>
        callback(
          error,
          client ? track(client, owner) : client,
          client?.release,
        ),
      );
    return (original() as Promise<PoolClient>).then((client) =>
      track(client, owner),
    );
  };
  return {
    pool,
    stats,
    heldBy: (id: number) => held.get(id) ?? 0,
    checkedOut: () => pool.totalCount - pool.idleCount,
    restore: () => {
      delete (pool as unknown as { connect?: unknown }).connect;
    },
  };
}

const customerIdentity = async (userId: string) => {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) throw new Error("failed to resolve customer identity");
  return identity;
};

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

const PARALLEL = 10;

describe("ten concurrent submission completions on the real pool of ten (W5, W9)", () => {
  async function seedSubmissions(count: number) {
    const s = await seedIntake("ptm06-pool");
    const identity = await customerIdentity(s.customer.user.id);
    const worlds = [];
    for (let index = 0; index < count; index++) {
      const [submission] = await db
        .insert(schema.submissionTable)
        .values({
          organisationId: s.customer.orgId,
          requesterId: s.customer.person.id,
          requestTypeId: s.requestType.id,
          requestTypeVersionId: s.version.id,
          formData: {},
          state: "new",
          submittedAt: new Date(),
        })
        .returning();
      if (!submission) throw new Error("submission not created");
      const attachmentId = randomUUID();
      const pendingKey = `workspace/${s.t.workspaceId}/submission/${submission.id}/attachment/${attachmentId}/evidence.png`;
      const file = path.join(root, pendingKey);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, png(60));
      // Declared 10 bytes (what presign counted), really 60: the quota check is the real one.
      await db.insert(schema.attachmentTable).values({
        id: attachmentId,
        workspaceId: s.t.workspaceId,
        organisationId: s.customer.orgId,
        submissionId: submission.id,
        objectKey: pendingKey,
        filename: "evidence.png",
        mimeType: "image/png",
        size: 10,
        state: "pending",
        customerVisible: true,
        uploadedBy: s.customer.person.id,
      });
      worlds.push({
        submission,
        attachmentId,
        pendingKey,
        input: {
          attachmentId,
          submissionId: submission.id,
          submissionWorkItemId: null,
          requesterId: s.customer.person.id,
          workspaceId: s.t.workspaceId,
          identity,
        },
      });
    }
    return { s, worlds };
  }

  it("never holds a connection, row lock or advisory lock during storage I/O, never acquires a second connection, and finishes with correct ready/CAS/quota results", async () => {
    const { s, worlds } = await seedSubmissions(PARALLEL);
    // Total 599: each completion sees nine others (ready at 60, or still pending at 10) plus its
    // own 60. Completions serialize on the organisation quota advisory lock, so exactly the last
    // one to take it sees nine READY rows (540) + 60 = 600 > 599 and is refused with 429.
    await setQuota(s.t.workspaceId, 599);

    const requests = new AsyncLocalStorage<{ id: number }>();
    const measured = instrumentPool(requests);
    expect(measured.pool.options.max).toBe(10);

    const phaseA = barrier(PARALLEL);
    const phaseC = barrier(PARALLEL);
    const realSizeLimit = attachmentRepository.getSubmissionAttachmentSizeLimit;
    // Called inside the Phase A authorization transaction, i.e. while its connection is held.
    vi.spyOn(
      attachmentRepository,
      "getSubmissionAttachmentSizeLimit",
    ).mockImplementation(async (executor) => {
      await phaseA.arrive();
      return realSizeLimit(executor);
    });
    const realFinalize = storage.finalizeStorageObject;
    const seenInIo: { id: number | undefined; held: number | undefined }[] = [];
    vi.spyOn(storage, "finalizeStorageObject").mockImplementation(
      async (oldKey, newKey) => {
        const id = requests.getStore()?.id;
        seenInIo.push({
          id,
          held: id === undefined ? undefined : measured.heldBy(id),
        });
        await phaseC.arrive();
        return realFinalize(oldKey, newKey);
      },
    );

    const probe = rawClient();
    await probe.connect();
    // The database clock bracketing the run, read on the raw probe (not the measured pool).
    const clock = async () =>
      (
        await probe.query<{ t: number }>(
          "SELECT extract(epoch FROM clock_timestamp())::float8 AS t",
        )
      ).rows[0]?.t as number;
    const clockBefore = await clock();
    let clockAfter = clockBefore;
    let runs: Promise<Settled<unknown>>[] = [];
    try {
      runs = worlds.map((world, id) =>
        settle(
          requests.run({ id }, () => completeSubmissionAttachment(world.input)),
        ),
      );

      // Phase A: every transaction holds its connection, so the pool of ten is exhausted.
      await within(phaseA.full, "all ten requests inside Phase A");
      expect(measured.checkedOut()).toBe(PARALLEL);
      expect(measured.stats.live).toBe(PARALLEL);
      for (let id = 0; id < PARALLEL; id++) expect(measured.heldBy(id)).toBe(1);
      phaseA.open();

      // Phase C: every request is inside storage I/O. Nothing may be held for any of them.
      await within(phaseC.full, "all ten requests inside Phase C");
      expect(seenInIo).toHaveLength(PARALLEL);
      for (const seen of seenInIo) expect(seen.held).toBe(0);
      for (let id = 0; id < PARALLEL; id++) expect(measured.heldBy(id)).toBe(0);
      expect(measured.stats.live).toBe(0);
      expect(measured.checkedOut()).toBe(0);
      const attachmentIds = worlds.map((world) => world.attachmentId);
      const submissionIds = worlds.map((world) => world.submission.id);
      // NOWAIT fails (55P03) if any transaction still holds one of these rows.
      await probe.query("BEGIN");
      try {
        await probe.query(
          "SELECT id FROM attachment WHERE id = ANY($1) FOR UPDATE NOWAIT",
          [attachmentIds],
        );
        await probe.query(
          "SELECT id FROM submission WHERE id = ANY($1) FOR UPDATE NOWAIT",
          [submissionIds],
        );
      } finally {
        await probe.query("ROLLBACK");
      }
      const advisory = await probe.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid <> pg_backend_pid()",
      );
      expect(advisory.rows[0]?.n).toBe(0);
      const busy = await probe.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')",
      );
      expect(busy.rows[0]?.n).toBe(0);
      // The ten reservations are committed (visible to another connection) before storage runs.
      const intents = await probe.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM attachment_object_gc WHERE attachment_id = ANY($1)",
        [attachmentIds],
      );
      expect(intents.rows[0]?.n).toBe(PARALLEL);
      phaseC.open();

      const results = await within(Promise.all(runs), "all completions settle");
      clockAfter = await clock();
      const statuses = results.map((result) =>
        result.status === "fulfilled" ? 200 : httpStatus(result),
      );
      // No request failed for want of a pooled connection.
      for (const result of results)
        if (result.status === "rejected")
          expect(String((result.reason as Error)?.message)).not.toMatch(
            /timeout exceeded when trying to connect/i,
          );
      expect(statuses.filter((status) => status === 200)).toHaveLength(9);
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    } finally {
      phaseA.open();
      phaseC.open();
      await Promise.allSettled(runs);
      await probe.end();
      measured.restore();
    }

    // No request ever held two clients at once; the pool never exceeded its ten.
    expect(measured.stats.nested).toEqual([]);
    expect(measured.stats.peakHeldByOneRequest).toBe(1);
    expect(measured.stats.peakLive).toBeLessThanOrEqual(10);
    expect(measured.stats.checkouts).toBeGreaterThan(PARALLEL);
    expect(measured.stats.live).toBe(0);

    // Ready/CAS/quota: nine ready rows at the real size, the refused one gone, bytes consistent.
    const rows = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.workspaceId, s.t.workspaceId));
    const ready = rows.filter((row) => row.state === "ready");
    expect(ready).toHaveLength(9);
    expect(rows).toHaveLength(9);
    for (const row of ready) expect(row.size).toBe(60);
    const usage = await attachmentRepository.readOrganisationStorageUsage(db, {
      workspaceId: s.t.workspaceId,
    });
    expect(usage?.usedBytes).toBe(540);
    expect(usage?.usedBytes).toBeLessThanOrEqual(usage?.maxStorageBytes ?? 0);
    expect((await listFiles(root)).sort()).toEqual(
      ready.map((row) => path.join(root, row.objectKey)).sort(),
    );
    // No completion intent is left: each was consumed with ready (nine) or dropped after the
    // settled 429 rejection with a successful delete (one).
    const intentCount = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM attachment_object_gc WHERE attachment_id IS NOT NULL`,
    );
    expect(intentCount.rows[0]?.n).toBe(0);
    // What remains in the queue is the P1R2-6 legacy contract, one row per request: the VACATED
    // pending key (Phase C queues it best effort after every copy, including the refused call's),
    // a legacy row (all three intent fields NULL, no attempts) not eligible until the upload
    // credential's lifetime plus its 60 second margin has passed.
    const eligibleAfter = storage.attachmentUploadUrlTtlSeconds() + 60;
    const vacated = await db.execute<{
      object_key: string;
      source_workspace_id: string | null;
      attachment_id: string | null;
      storage_driver: string | null;
      retry_at: string | null;
      attempts: number;
      queued_epoch: number;
    }>(sql`
      SELECT object_key, source_workspace_id, attachment_id, storage_driver, retry_at,
             attempts, extract(epoch FROM queued_at)::float8 AS queued_epoch
      FROM attachment_object_gc ORDER BY object_key`);
    expect(vacated.rows.map((row) => row.object_key).sort()).toEqual(
      worlds.map((world) => world.pendingKey).sort(),
    );
    for (const row of vacated.rows) {
      expect(row.source_workspace_id).toBe(s.t.workspaceId);
      expect(row.attachment_id).toBeNull();
      expect(row.storage_driver).toBeNull();
      expect(row.retry_at).toBeNull();
      expect(row.attempts).toBe(0);
      // Queued in the future by exactly TTL + 60 s from the moment of the insert, which lies
      // between the two database clock readings (transaction start <= the later reading).
      expect(row.queued_epoch).toBeGreaterThanOrEqual(
        clockBefore + eligibleAfter - 1,
      );
      expect(row.queued_epoch).toBeLessThanOrEqual(
        clockAfter + eligibleAfter + 1,
      );
    }
  }, 90_000);
});

describe("shared K=3 reservation through both routes on one admissible attachment row", () => {
  // An accepted submission whose converted, live work item (the requester's) carries the
  // requester's pending upload: the one arrangement where a single attachment row is reachable by
  // the ordinary portal route AND the submission route (accepted-parent branch).
  async function acceptedWorld() {
    const s = await seedIntake("ptm06-cross-route");
    const identity = await customerIdentity(s.customer.user.id);
    await db
      .update(schema.workItemTable)
      .set({ requesterId: s.customer.person.id })
      .where(eq(schema.workItemTable.id, s.t.workItem.id));
    const [submission] = await db
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
      .returning();
    if (!submission) throw new Error("submission not created");
    const id = randomUUID();
    const pendingKey = `workspace/${s.t.workspaceId}/work-item/${s.t.workItem.id}/attachment/${id}/evidence.png`;
    const file = path.join(root, pendingKey);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, png(64));
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
      ordinary: () =>
        completeAttachment({
          attachmentId: id,
          workspaceId: s.t.workspaceId,
          workItemId: s.t.workItem.id,
          actorId: s.customer.user.id,
          actorType: "person",
          identity,
          portal: true,
        }),
      submission: () =>
        completeSubmissionAttachment({
          attachmentId: id,
          submissionId: submission.id,
          submissionWorkItemId: submission.workItemId,
          requesterId: s.customer.person.id,
          workspaceId: s.t.workspaceId,
          identity,
        }),
    };
  }

  it("admits at most three intents across two ordinary and two submission completions, refuses the rest before storage, and never deadlocks (no 40P01)", async () => {
    const w = await acceptedWorld();
    // One intent already exists for the row (for example an earlier unknown outcome).
    await db.execute(sql`
      INSERT INTO attachment_object_gc
        (object_key, source_workspace_id, attachment_id, storage_driver, queued_at, retry_at)
      VALUES (${`seed-${randomUUID()}`}, ${w.s.t.workspaceId}, ${w.id},
              ${storage.getStorageBackendFingerprint()}, 'infinity'::timestamptz,
              now() + interval '1 day')`);
    const realFinalize = storage.finalizeStorageObject;
    // Two reservations remain under the cap of three: those two reach storage and wait here.
    const io = barrier(2);
    const finalize = vi
      .spyOn(storage, "finalizeStorageObject")
      .mockImplementation(async (oldKey, newKey) => {
        await io.arrive();
        return realFinalize(oldKey, newKey);
      });
    const probe = rawClient();
    await probe.connect();
    let runs: Promise<Settled<unknown>>[] = [];
    const early: Settled<unknown>[] = [];
    try {
      runs = [w.ordinary(), w.ordinary(), w.submission(), w.submission()].map(
        (run) =>
          settle(run).then((result) => {
            early.push(result);
            return result;
          }),
      );
      await within(io.full, "two admitted reservations reach storage");
      // The other two are refused by the cap while the admitted two are still held in storage.
      await within(
        (async () => {
          while (early.length < 2)
            await new Promise((resolve) => setTimeout(resolve, 20));
        })(),
        "two calls refused by the cap",
      );
      expect(early.map(httpStatus)).toEqual([409, 409]);
      expect(finalize).toHaveBeenCalledTimes(2);
      const visible = await probe.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM attachment_object_gc WHERE attachment_id = $1",
        [w.id],
      );
      expect(visible.rows[0]?.n).toBe(3);
      io.open();
      const results = await within(Promise.all(runs), "all four settle");
      // No storage call for a refused call; never more than two reached finalize.
      expect(finalize).toHaveBeenCalledTimes(2);
      const statuses = results.map((result) =>
        result.status === "fulfilled" ? 200 : httpStatus(result),
      );
      for (const result of results)
        if (result.status === "rejected") {
          expect(pgCode(result.reason)).not.toBe("40P01");
          expect(result.reason).toBeInstanceOf(HTTPException);
        }
      // Two refused by the cap; of the two admitted exactly one becomes ready.
      expect(
        statuses.filter((status) => status === 409).length,
      ).toBeGreaterThanOrEqual(2);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    } finally {
      io.open();
      await Promise.allSettled(runs);
      await probe.end();
    }
    const [row] = await db
      .select()
      .from(schema.attachmentTable)
      .where(eq(schema.attachmentTable.id, w.id));
    expect(row?.state).toBe("ready");
    // Only the seeded locator remains: the winner consumed its own, the loser dropped its own.
    const intents = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM attachment_object_gc WHERE attachment_id = ${w.id}`,
    );
    expect(intents.rows[0]?.n).toBe(1);
    expect(await listFiles(root)).toEqual([
      path.join(root, row?.objectKey as string),
    ]);
  }, 60_000);
});
