/**
 * #895: transient database and connection failures inside a chunk (or finalize) are retried a bounded
 * number of times inside the runner, reconciling against the persisted run before each retry, so a
 * blip does not force a manual resume. Persistent failures still pause as `chunk_failed`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { importChunkTable } from "../../../apps/api/src/database/schema-imports";
import { subscribeToEvent } from "../../../apps/api/src/events";
import {
  unreadableRecord,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  isTransientImportError,
  revivePendingPublish,
  runImportRun,
  runImportRunJob,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { setImportAttachmentDependencies } from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { createWorkItem } from "../../../apps/api/src/work-item/controllers/create-work-item";
import { resetTestDatabase } from "../helpers/database";
import {
  call,
  confirmAll,
  dryRunAndExecuteBody,
  engineFixture,
  makeRecords,
  post,
  registerFake,
  runRow,
  setFakeFixture,
  startRun,
} from "./engine-helpers";

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  clearFakeFixtures();
  registerFake(10);
});
afterEach(() => unregisterImportAdapter("import.mcp"));

const pgError = (code: string) =>
  Object.assign(new Error(`injected ${code}`), { code });
const itemCount = async () =>
  (await db.select().from(schema.workItemTable)).length;
const pendingChunks = async () =>
  (await db.select().from(schema.importChunkTable)).filter(
    (c) => c.pendingPublish !== null,
  ).length;
const linkCount = async () =>
  (await db.select().from(schema.importRecordLinkTable)).length;

async function executed(id: string, count: number) {
  const f = await engineFixture();
  setFakeFixture(id, { records: makeRecords(f.type.key, count) });
  const { app } = createApp();
  const { run, mapping } = await startRun(app, f, id);
  await confirmAll(app, f.key, run.id, mapping.mappingVersion);
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  await call(app, f.key, `/api/imports/${run.id}/execute`, post(dry.body), 202);
  return { f, app, run };
}

describe("transient chunk failures (#895)", () => {
  it("classifies connection-class failures as transient and validation failures as not", () => {
    for (const code of ["57P01", "53300", "08006", "08003", "ECONNRESET"])
      expect(isTransientImportError(pgError(code))).toBe(true);
    expect(
      isTransientImportError(new Error("outer", { cause: pgError("57P01") })),
    ).toBe(true);
    expect(
      isTransientImportError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
    for (const code of ["23505", "22P02", "42P01", "40001"])
      expect(isTransientImportError(pgError(code))).toBe(false);
    expect(isTransientImportError(new Error("boom"))).toBe(false);
    // Driver errors without a code: what node-postgres throws once Drizzle's rollback fails.
    expect(
      isTransientImportError(
        new Error(
          "Client has encountered a connection error and is not queryable",
        ),
      ),
    ).toBe(true);
    // Imported text in a wrapped query must never make a terminal error retryable.
    expect(
      isTransientImportError(
        new Error("Failed query: insert ... params: connection terminated", {
          cause: pgError("23505"),
        }),
      ),
    ).toBe(false);
    expect(
      isTransientImportError(
        new Error("Failed query: insert ... params: connection terminated"),
      ),
    ).toBe(false);
  });

  it("a transient error injected once succeeds without a manual resume", async () => {
    const { run } = await executed("once", 30);
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        if (calls === 1) throw pgError("57P01");
      },
    });
    expect(outcome).toMatchObject({ status: "completed", chunks: 3 });
    expect(await itemCount()).toBe(30);
    expect(await linkCount()).toBe(30);
  });

  it("a persistent transient error pauses as chunk_failed after the bound", async () => {
    const { run } = await executed("persistent", 30);
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        throw pgError("53300");
      },
    });
    expect(outcome).toMatchObject({
      status: "paused",
      pausedReason: "chunk_failed",
    });
    expect(calls).toBe(4);
    expect(await itemCount()).toBe(0);
    expect(await runRow(run.id)).toMatchObject({
      state: "paused",
      pausedReason: "chunk_failed",
    });
  });

  it("a terminal error is never retried", async () => {
    const { run } = await executed("terminal", 30);
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        throw pgError("22P02");
      },
    });
    expect(outcome).toMatchObject({ pausedReason: "chunk_failed" });
    expect(calls).toBe(1);
  });

  it("an uncertain commit (error after the commit) reconciles from the cursor and creates no duplicates", async () => {
    const { run } = await executed("uncertain", 30);
    let calls = 0;
    let afterFirstCommit = -1;
    const outcome = await runImportRun(run.id, {
      afterCommit: async () => {
        calls += 1;
        if (calls !== 1) return;
        afterFirstCommit = await itemCount();
        throw pgError("08006");
      },
    });
    // The first chunk was durably committed before the error, and was not written again.
    expect(afterFirstCommit).toBe(10);
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
    expect(await linkCount()).toBe(30);
  });

  it("cancellation during the retry stops it", async () => {
    const { f, app, run } = await executed("cancel", 30);
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        throw pgError("57P01");
      },
      beforeRetry: async () => {
        await call(app, f.key, `/api/imports/${run.id}/pause`, post(), 200);
      },
    });
    expect(outcome).toMatchObject({
      status: "paused",
      pausedReason: "operator",
    });
    expect(calls).toBe(1);
    expect(await itemCount()).toBe(0);
  });

  it("a real broken connection whose rollback fails is still retried", async () => {
    const { run } = await executed("broken", 20);
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async (tx) => {
        calls += 1;
        if (calls !== 1) return;
        await tx.execute(sql`select pg_terminate_backend(pg_backend_pid())`);
      },
    });
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(20);
  });

  it("failures reloading the run share the retry budget: recovery, then exhaustion", async () => {
    const first = await executed("reload-ok", 20);
    let chunkCalls = 0;
    let reloads = 0;
    const ok = await runImportRun(first.run.id, {
      duringChunk: async () => {
        chunkCalls += 1;
        if (chunkCalls === 1) throw pgError("57P01");
      },
      beforeSnapshot: async () => {
        reloads += 1;
        // The reload straight after the chunk failure is refused too (reloads 2 and 3).
        if (reloads === 2 || reloads === 3) throw pgError("57P01");
      },
    });
    expect(ok).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(20);

    await resetTestDatabase();
    clearFakeFixtures();
    const second = await executed("reload-bad", 20);
    const bad = await runImportRun(second.run.id, {
      beforeSnapshot: async () => {
        throw pgError("57P01");
      },
    });
    expect(bad).toMatchObject({
      status: "paused",
      pausedReason: "chunk_failed",
    });
    expect(await runRow(second.run.id)).toMatchObject({
      state: "paused",
      pausedReason: "chunk_failed",
    });
  });

  it("each chunk gets its own budget after reconciliation confirms progress, and every chunk is published once", async () => {
    const { run } = await executed("budget", 50);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      afterCommit: async () => {
        calls += 1;
        if (calls <= 4) throw pgError("08006");
      },
    });
    expect(outcome).toMatchObject({ status: "completed", chunks: 5 });
    expect(await itemCount()).toBe(50);
    expect(await linkCount()).toBe(50);
    expect(created).toHaveLength(50);
  });

  it("a lost response on the final chunk still publishes that chunk before completion", async () => {
    const { run } = await executed("lost-final", 10);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      afterCommit: async () => {
        calls += 1;
        if (calls === 1) throw pgError("57P01");
      },
    });
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(10);
    expect(created).toHaveLength(10);
  });

  it("finalization: a transient failure recovers; an uncertain completion is not repeated", async () => {
    const { run } = await executed("final-ok", 10);
    let finals = 0;
    const outcome = await runImportRun(run.id, {
      duringFinalize: async () => {
        finals += 1;
        if (finals === 1) throw pgError("57P01");
      },
    });
    expect(outcome).toMatchObject({ status: "completed" });
    expect(finals).toBe(2);
    expect(await runRow(run.id)).toMatchObject({ state: "completed" });

    await resetTestDatabase();
    clearFakeFixtures();
    const second = await executed("final-uncertain", 10);
    let commits = 0;
    let finalizeRuns = 0;
    const again = await runImportRun(second.run.id, {
      duringFinalize: async () => {
        finalizeRuns += 1;
      },
      afterCommit: async () => {
        commits += 1;
        // Call 1 is the chunk, call 2 the completed finalize transaction.
        if (commits === 2) throw pgError("08006");
      },
    });
    expect(again).toMatchObject({ status: "completed" });
    expect(finalizeRuns).toBe(1);
    expect(await runRow(second.run.id)).toMatchObject({ state: "completed" });
  });

  it("finalization: the retry bound pauses as chunk_failed with the exhausted cursor persisted", async () => {
    const { run } = await executed("final-bad", 10);
    let finals = 0;
    const outcome = await runImportRun(run.id, {
      duringFinalize: async () => {
        finals += 1;
        throw pgError("53300");
      },
    });
    expect(outcome).toMatchObject({
      status: "paused",
      pausedReason: "chunk_failed",
    });
    expect(finals).toBe(4);
    expect(await itemCount()).toBe(10);
    const row = await runRow(run.id);
    expect(row).toMatchObject({
      state: "paused",
      pausedReason: "chunk_failed",
    });
    expect(row.sourceCursor).toMatchObject({ exhausted: true });
  });

  it("finalization: a failure of the initial attachment read is retried, then bounded", async () => {
    const { run } = await executed("attach-read", 10);
    let reads = 0;
    const ok = await runImportRun(run.id, {
      beforeFinalizeRead: async () => {
        reads += 1;
        if (reads === 1) throw pgError("57P01");
      },
    });
    expect(ok).toMatchObject({ status: "completed" });
    expect(reads).toBe(2);

    await resetTestDatabase();
    clearFakeFixtures();
    const second = await executed("attach-read-bad", 10);
    reads = 0;
    const bad = await runImportRun(second.run.id, {
      beforeFinalizeRead: async () => {
        reads += 1;
        throw pgError("57P01");
      },
    });
    expect(bad).toMatchObject({
      status: "paused",
      pausedReason: "chunk_failed",
    });
    expect(reads).toBe(4);
    expect(await runRow(second.run.id)).toMatchObject({ state: "paused" });
  });

  it("pages of only rejected records reset the budget too (lost commit on each of 4 pages)", async () => {
    const f = await engineFixture();
    setFakeFixture("rejects", {
      records: Array.from({ length: 50 }, (_, i) =>
        unreadableRecord({
          sourceType: "issue",
          sourceId: `BAD-${i}`,
          code: "unreadable_item",
        }),
      ),
    });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "rejects");
    await confirmAll(app, f.key, run.id, mapping.mappingVersion);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      afterCommit: async () => {
        calls += 1;
        if (calls <= 4) throw pgError("08006");
      },
    });
    expect(outcome).toMatchObject({ status: "completed", chunks: 5 });
    expect(await itemCount()).toBe(0);
  });

  it("a fourth attempt that commits but loses its response is reconciled and published, not paused", async () => {
    const { run } = await executed("budget-edge", 10);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    let chunkCalls = 0;
    let commits = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        chunkCalls += 1;
        if (chunkCalls <= 3) throw pgError("57P01"); // three rolled-back attempts spend the budget
      },
      afterCommit: async () => {
        commits += 1;
        if (commits === 1) throw pgError("08006"); // attempt 4 committed; the response is lost
      },
    });
    expect(chunkCalls).toBe(4);
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(10);
    expect(created).toHaveLength(10);
  });

  it("publish events survive a pause: uncertain 4th commit, failed reload, pause, manual resume publishes", async () => {
    const { f, app, run } = await executed("durable-pause", 10);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    let chunkCalls = 0;
    let lost = false;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        chunkCalls += 1;
        if (chunkCalls <= 3) throw pgError("57P01");
      },
      afterCommit: async () => {
        lost = true;
        throw pgError("08006"); // attempt 4 committed; its response is lost
      },
      beforeSnapshot: async () => {
        if (lost) throw pgError("57P01"); // the reconciling reload fails too
      },
    });
    expect(outcome).toMatchObject({
      status: "paused",
      pausedReason: "chunk_failed",
    });
    expect(await itemCount()).toBe(10);
    expect(created).toHaveLength(0);
    expect(await pendingChunks()).toBe(1);

    await call(app, f.key, `/api/imports/${run.id}/resume`, post(), 200);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(created).toHaveLength(10);
    expect(await pendingChunks()).toBe(0);
  });

  it("publish events survive a process restart between commit and dispatch", async () => {
    const { run } = await executed("durable-restart", 30);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    let commits = 0;
    await expect(
      runImportRun(run.id, {
        afterCommit: async () => {
          commits += 1;
          if (commits === 1) throw pgError("08006");
        },
        beforeSnapshot: async () => {
          if (commits === 1) {
            commits += 1;
            throw new Error("process died"); // not transient: escapes the runner
          }
        },
      }),
    ).rejects.toThrow("process died");
    expect(await itemCount()).toBe(10);
    expect(created).toHaveLength(0);
    expect(await pendingChunks()).toBe(1);

    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
    expect(created).toHaveLength(30);
    expect(await pendingChunks()).toBe(0);
  });

  it("a crash after dispatch but before clearing republishes (duplicates allowed)", async () => {
    const { run } = await executed("durable-dup", 10);
    const created: unknown[] = [];
    let stored: unknown = null;
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
      // Handlers may overlap: only a read made before the clear holds the events.
      const [row] = await db
        .select({ pending: schema.importChunkTable.pendingPublish })
        .from(schema.importChunkTable);
      if (row?.pending) stored = row.pending;
    });
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(created).toHaveLength(10);
    expect(stored).not.toBeNull();
    // The dispatch happened, the clear did not: put the stored events back.
    await db
      .update(schema.importChunkTable)
      .set({ pendingPublish: stored as Record<string, unknown> });
    await runImportRun(run.id);
    expect(created).toHaveLength(20);
    expect(await pendingChunks()).toBe(0);
  });

  it("a rollback leaves cursor, stats and version exactly as the earlier successful chunk left them", async () => {
    const { run } = await executed("rollback-state", 30);
    let before: Awaited<ReturnType<typeof runRow>> | null = null;
    let calls = 0;
    let checked = false;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        if (calls === 2) {
          before = await runRow(run.id); // chunk 1 committed; chunk 2 writes are in flight
          throw pgError("57P01");
        }
      },
      beforeRetry: async () => {
        if (checked) return;
        checked = true;
        const after = await runRow(run.id);
        expect(before).not.toBeNull();
        expect(after.sourceCursor).toEqual(before?.sourceCursor);
        expect(after.stats).toEqual(before?.stats);
        expect(after.version).toBe(before?.version);
        expect(await itemCount()).toBe(10);
      },
    });
    expect(checked).toBe(true);
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
  });

  it("an agent create racing a rolled-back chunk keeps work item keys unique", async () => {
    const { f, run } = await executed("agent-race", 10);
    let agent: Promise<unknown> | null = null;
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        if (calls !== 1) return;
        // Starts while the chunk holds the project's number claims; it can only finish after the
        // injected failure rolls them back.
        agent = createWorkItem({
          projectId: f.project.id,
          workspaceId: f.workspace.id,
          typeId: f.type.id,
          title: "agent item",
          actorId: f.user.id,
          actorType: "person",
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        throw pgError("57P01");
      },
    });
    await agent;
    expect(outcome).toMatchObject({ status: "completed" });
    const items = await db.select().from(schema.workItemTable);
    expect(items).toHaveLength(11);
    expect(new Set(items.map((i) => i.key)).size).toBe(11);
  });

  it("revives only the known Date fields; ISO-shaped identifiers stay strings", () => {
    const iso = "2026-11-24T00:00:00.000Z";
    const revived = revivePendingPublish({
      attachmentJobs: [{ sourceId: iso, attachments: [{ sourceId: iso }] }],
      createdResults: [
        {
          created: { key: iso },
          realtimeEvent: { id: "e", occurredAt: iso },
          initialEvents: [
            {
              event: { occurredAt: iso },
              payload: {
                changes: [
                  { field: "dueDate", from: null, to: iso },
                  { field: "title", from: iso, to: iso },
                ],
              },
            },
          ],
        },
      ],
      updateResults: [],
    });
    expect(revived.attachmentJobs).toEqual([
      { sourceId: iso, attachments: [{ sourceId: iso }] },
    ]);
    const created = revived.createdResults?.[0];
    expect(created?.created.key).toBe(iso);
    expect(created?.realtimeEvent.occurredAt).toBeInstanceOf(Date);
    expect(created?.initialEvents[0].event.occurredAt).toBeInstanceOf(Date);
    const [due, title] = created?.initialEvents[0].payload.changes ?? [];
    expect(due.to).toBeInstanceOf(Date);
    expect(title).toEqual({ field: "title", from: iso, to: iso });
  });

  it("an ISO-shaped source and attachment id keep their identity through the stored publish", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "t895-"));
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
    const original = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    setImportAttachmentDependencies({
      download: vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7,
          8,
        ]),
        contentType: "image/png",
      })),
    });
    try {
      const iso = "2026-11-24T00:00:00.000Z";
      const f = await engineFixture();
      const [record] = makeRecords(f.type.key, 1);
      setFakeFixture("iso", {
        records: [
          {
            ...(record as NonNullable<typeof record>),
            sourceId: iso,
            attachments: [
              {
                sourceId: iso,
                url: "https://files.source.example.test/a.png",
                filename: "a.png",
              },
            ],
          },
        ],
      });
      const { app } = createApp();
      const { run, mapping } = await startRun(app, f, "iso");
      await confirmAll(app, f.key, run.id, mapping.mappingVersion);
      const dry = await dryRunAndExecuteBody(app, f.key, run.id);
      await call(
        app,
        f.key,
        `/api/imports/${run.id}/execute`,
        post(dry.body),
        202,
      );
      expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
      expect(await db.select().from(schema.attachmentTable)).toHaveLength(1);
      const external = (await db.select().from(schema.importProvenanceTable))
        .filter((p) => p.entityType === "attachment")
        .map((p) => p.externalId);
      expect(external).toEqual([`issue:${iso}#attachment:${iso}`]);
    } finally {
      setImportAttachmentDependencies(null);
      await rm(root, { recursive: true, force: true });
      if (original === undefined)
        // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
        delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
      else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = original;
    }
  });

  it("a transient failure while selecting or clearing pending events keeps them and recovers", async () => {
    const { run } = await executed("drain-transient", 20);
    const created: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      created.push(d);
    });
    const failed = new Set<string>();
    const outcome = await runImportRun(run.id, {
      duringDrain: async (stage) => {
        // Each stage fails once (the first time it is reached with chunk data to handle).
        if (stage === "clear" && !failed.has("clear")) {
          failed.add("clear");
          throw pgError("57P01");
        }
        if (
          stage === "select" &&
          failed.has("clear") &&
          !failed.has("select")
        ) {
          failed.add("select");
          throw pgError("57P01");
        }
      },
    });
    expect(failed).toEqual(new Set(["clear", "select"]));
    expect(outcome).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(20);
    // Dispatched but not cleared is republished on the retry (duplicates allowed), never lost.
    expect(created.length).toBeGreaterThanOrEqual(20);
    const pending = await db
      .select({ id: importChunkTable.id })
      .from(importChunkTable)
      .where(sql`${importChunkTable.pendingPublish} IS NOT NULL`);
    expect(pending).toHaveLength(0);
  });

  it("a worker that lost its lease neither publishes nor clears pending events", async () => {
    const steal = (runId: string) =>
      db.execute(
        sql`UPDATE job_lease SET "owner" = 'other-replica' WHERE "name" = ${`import-run:${runId}`}`,
      );
    const pendingCount = async () =>
      (
        await db
          .select({ id: importChunkTable.id })
          .from(importChunkTable)
          .where(sql`${importChunkTable.pendingPublish} IS NOT NULL`)
      ).length;

    // Ownership moves before the drain's dispatch: nothing is published, the chunk stays pending.
    const first = await executed("stale-publish", 10);
    const events: unknown[] = [];
    await subscribeToEvent("work_item.created", async (d) => {
      events.push(d);
    });
    await expect(
      runImportRunJob(first.run.id, {
        duringDrain: async (stage) => {
          if (stage === "select") await steal(first.run.id);
        },
      }),
    ).rejects.toThrow(/reservation is no longer owned/);
    expect(events).toHaveLength(0);
    expect(await pendingCount()).toBe(1);

    // Ownership moves after dispatch, before the clear: the stale worker cannot clear it.
    await resetTestDatabase();
    clearFakeFixtures();
    const second = await executed("stale-clear", 10);
    await expect(
      runImportRunJob(second.run.id, {
        duringDrain: async (stage) => {
          if (stage === "clear") await steal(second.run.id);
        },
      }),
    ).rejects.toThrow(/reservation is no longer owned/);
    expect(await pendingCount()).toBe(1);
  });
});
