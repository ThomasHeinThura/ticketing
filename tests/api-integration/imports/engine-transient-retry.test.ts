/**
 * #895: transient database and connection failures inside a chunk (or finalize) are retried a bounded
 * number of times inside the runner, reconciling against the persisted run before each retry, so a
 * blip does not force a manual resume. Persistent failures still pause as `chunk_failed`.
 */
import type { EventEmitter } from "node:events";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { subscribeToEvent } from "../../../apps/api/src/events";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import {
  isTransientImportError,
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
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
        // pg emits 'error' on a checked-out client that nothing listens to; absorb it for this client.
        (
          tx as unknown as { session: { client: EventEmitter } }
        ).session.client.on("error", () => {});
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
});
