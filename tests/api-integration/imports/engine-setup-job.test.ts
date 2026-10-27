/**
 * Discovery and the whole-run dry run run as a background job (P6-R1-06): the request answers 202,
 * progress is persisted on the run, a second request never starts a second read, and a killed dry
 * run resumes from its checkpoint with the same report.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db from "../../../apps/api/src/database";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import { setImportEngineAutoStart } from "../../../apps/api/src/imports/engine/runner";
import { runSetupJob } from "../../../apps/api/src/imports/engine/setup-job";
import {
  clearFakeFixtures,
  fakeDiscovers,
  fakeReads,
} from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  type App,
  call,
  confirmAll,
  dryRunAndWait,
  engineFixture,
  makeRecords,
  post,
  registerFake,
  req,
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

const engine = (app: App, key: string, runId: string) =>
  call(app, key, `/api/imports/${runId}/engine`, undefined, 200);

function gate() {
  let open: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { until, open };
}

async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("background setup job (P6-R1-06)", () => {
  it("discovery answers 202, runs in the background and a duplicate request does not scan twice", async () => {
    const f = await engineFixture();
    setFakeFixture("bg-discover", { records: makeRecords(f.type.key, 25) });
    const { app } = createApp();
    const source = await call(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        name: "bg",
        config: { fixture: "bg-discover" },
      }),
      200,
    );
    const run = await call(
      app,
      f.key,
      `/api/import-sources/${source.id}/runs`,
      post({ projectId: f.project.id, sourceRef: "bg-discover" }),
      200,
    );
    const first = await call(
      app,
      f.key,
      `/api/imports/${run.id}/discover`,
      post(),
      202,
    );
    expect(first).toMatchObject({
      status: "accepted",
      job: { kind: "discover", status: "running", pagesRead: 0 },
    });
    // Nothing was read inside the request.
    expect(fakeDiscovers.count).toBe(0);
    const second = await call(
      app,
      f.key,
      `/api/imports/${run.id}/discover`,
      post(),
      202,
    );
    expect(second).toMatchObject({
      status: "running",
      job: { kind: "discover" },
    });
    // A dry run cannot start while discovery runs.
    const clash = await req(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      post(),
    );
    expect(clash.status).toBe(409);
    expect(await runSetupJob(run.id)).toMatchObject({ status: "completed" });
    expect(await runSetupJob(run.id)).toMatchObject({ status: "idle" });
    expect(fakeDiscovers.count).toBe(1);
    const done = await engine(app, f.key, run.id);
    expect(done).toMatchObject({
      phase: "discovered",
      job: { kind: "discover", status: "completed", recordsProcessed: 25 },
    });
    const mapping = await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      undefined,
      200,
    );
    expect(mapping.discovery).toMatchObject({ totalRecords: 25 });
  });

  it("a dry-run request while one runs returns its state; a second worker is idle; each page is read once", async () => {
    const f = await engineFixture();
    const held = gate();
    const records = makeRecords(f.type.key, 30);
    setFakeFixture("single", { records });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "single");
    await confirmAll(app, f.key, run.id, mapping.mappingVersion);
    setFakeFixture("single", {
      records,
      holdAtCursor: { cursor: "10", until: held.until },
    });
    fakeReads.length = 0;
    const accepted = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      post(),
      202,
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      job: { kind: "dry_run", status: "running", totalRecords: 30 },
    });
    const worker = runSetupJob(run.id);
    await waitFor(() => fakeReads.includes("10"), "the held read");
    const again = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      post(),
      202,
    );
    expect(again).toMatchObject({
      status: "running",
      job: { kind: "dry_run" },
    });
    expect(await runSetupJob(run.id)).toMatchObject({ status: "idle" });
    // Progress of the first page is visible while the second is held.
    const midway = await engine(app, f.key, run.id);
    expect(midway.job).toMatchObject({ status: "running" });
    held.open();
    expect(await worker).toMatchObject({ status: "completed", pages: 3 });
    expect(fakeReads).toEqual([null, "10", "20"]);
    const finished = await engine(app, f.key, run.id);
    expect(finished).toMatchObject({
      phase: "dry_run_ready",
      job: {
        kind: "dry_run",
        status: "completed",
        pagesRead: 3,
        recordsProcessed: 30,
      },
    });
    const report = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      undefined,
      200,
    );
    expect(report.counts).toMatchObject({ processed: 30, created: 30 });
  });

  it("a killed dry run resumes from its checkpoint and produces the same report", async () => {
    const f = await engineFixture();
    setFakeFixture("kill", { records: makeRecords(f.type.key, 55) });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "kill");
    await confirmAll(app, f.key, run.id, mapping.mappingVersion);
    const reference = await dryRunAndWait(app, f.key, run.id);

    await call(app, f.key, `/api/imports/${run.id}/dry-run-all`, post(), 202);
    fakeReads.length = 0;
    expect(
      await runSetupJob(run.id, { checkpointEvery: 2, stopAfterPages: 3 }),
    ).toMatchObject({ status: "stopped", pages: 3 });
    expect(fakeReads).toEqual([null, "10", "20"]);
    const killed = await engine(app, f.key, run.id);
    // Progress writes are throttled; the page-2 checkpoint always records its own progress.
    expect(killed.job).toMatchObject({ status: "running" });
    expect(killed.job.pagesRead).toBeGreaterThanOrEqual(2);
    // A worker that really died leaves its lease behind. While it is live nothing else runs; once
    // the short lease lapses, the restart (the sweep or the same request again) takes over.
    const lease = `import-setup:${run.id}`;
    await db.execute(sql`
      INSERT INTO job_lease ("name", "owner", "expires_at")
      VALUES (${lease}, 'dead-worker', (now() AT TIME ZONE 'utc') + interval '1 minute')`);
    expect(await runSetupJob(run.id)).toMatchObject({ status: "idle" });
    await db.execute(sql`
      UPDATE job_lease SET "expires_at" = (now() AT TIME ZONE 'utc') - interval '1 second'
       WHERE "name" = ${lease}`);
    // It continues from the page-2 checkpoint.
    fakeReads.length = 0;
    expect(await runSetupJob(run.id, { checkpointEvery: 2 })).toMatchObject({
      status: "completed",
    });
    expect(fakeReads).toEqual(["20", "30", "40", "50"]);
    const resumed = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      undefined,
      200,
    );
    expect(resumed.digest).toBe(reference.digest);
    expect(resumed.counts).toEqual(reference.counts);
  });

  it("a mapping edit while the dry run reads cancels it (mapping_changed) instead of storing a stale report", async () => {
    const f = await engineFixture();
    const held = gate();
    const records = makeRecords(f.type.key, 20);
    setFakeFixture("cancel", { records });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "cancel");
    const confirmed = await confirmAll(
      app,
      f.key,
      run.id,
      mapping.mappingVersion,
    );
    setFakeFixture("cancel", {
      records,
      holdAtCursor: { cursor: "10", until: held.until },
    });
    fakeReads.length = 0;
    await call(app, f.key, `/api/imports/${run.id}/dry-run-all`, post(), 202);
    const worker = runSetupJob(run.id);
    await waitFor(() => fakeReads.includes("10"), "the held read");
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      post({
        expectedMappingVersion: confirmed.mappingVersion,
        entries: [
          {
            domain: "state",
            value: "Backlog",
            target: { kind: "group", group: "unstarted" },
          },
        ],
      }),
      200,
    );
    held.open();
    expect(await worker).toMatchObject({ status: "idle" });
    const after = await engine(app, f.key, run.id);
    expect(after).toMatchObject({
      phase: "discovered",
      dryRun: null,
      job: { kind: "dry_run", status: "failed", failure: "mapping_changed" },
    });
    expect((await runRow(run.id)).engineDryRunDigest).toBeNull();
  });
});
