/**
 * #895: transient database and connection failures inside a chunk (or finalize) are retried a bounded
 * number of times inside the runner, reconciling against the persisted run before each retry, so a
 * blip does not force a manual resume. Persistent failures still pause as `chunk_failed`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
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
});
