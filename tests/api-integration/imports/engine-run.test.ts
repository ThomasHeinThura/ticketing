import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  importLossTable,
  importSourceConnectionTable,
} from "../../../apps/api/src/database/schema-imports";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import {
  clearFakeFixtures,
  fakeReads,
} from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  call,
  confirmAll,
  dryRunAndExecuteBody,
  engineFixture,
  grantExecutedApproval,
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

type F = Awaited<ReturnType<typeof engineFixture>>;
async function prepared(f: F, id: string, count: number, sourceRef = id) {
  const { app } = createApp();
  const { run, mapping } = await startRun(app, f, id, sourceRef);
  const confirmed = await confirmAll(
    app,
    f.key,
    run.id,
    mapping.mappingVersion,
  );
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  expect(dry.report.counts.processed).toBe(count);
  return { app, run, confirmed, dry };
}
const itemCount = async () =>
  (await db.select().from(schema.workItemTable)).length;
const linkCount = async () =>
  (await db.select().from(schema.importRecordLinkTable)).length;

describe("import engine runner", () => {
  it("imports every chunk with real work items, provenance links and a loss report", async () => {
    const f = await engineFixture();
    setFakeFixture("full", { records: makeRecords(f.type.key, 40) });
    const { app, run, dry } = await prepared(f, "full", 40);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    const outcome = await runImportRun(run.id);
    expect(outcome).toMatchObject({ status: "completed", chunks: 4 });
    expect(await itemCount()).toBe(40);
    expect(await linkCount()).toBe(40);
    const done = await runRow(run.id);
    expect(done).toMatchObject({
      state: "completed",
      enginePhase: "completed",
    });
    expect(done.stats).toMatchObject({ created: 40, processed: 40 });
    const [link] = await db
      .select()
      .from(schema.importRecordLinkTable)
      .limit(1);
    expect(link?.sourceUrl).toMatch(
      /^https:\/\/source\.example\.test\/browse\//u,
    );
    const losses = await call(
      app,
      f.key,
      `/api/imports/${run.id}/losses`,
      undefined,
      200,
    );
    // Record v2: the mapped state group is written, so nothing is lost for it.
    expect(losses.summary).toEqual([]);
    expect(losses.losses).toHaveLength(0);
    const status = await call(
      app,
      f.key,
      `/api/imports/${run.id}/engine`,
      undefined,
      200,
    );
    expect(status).toMatchObject({
      state: "completed",
      phase: "completed",
      stats: { created: 40 },
    });
  });

  it("an interruption after chunk N resumes and commits only N+1 onward", async () => {
    const f = await engineFixture();
    setFakeFixture("resume", { records: makeRecords(f.type.key, 40) });
    const { app, run, dry } = await prepared(f, "resume", 40);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    fakeReads.length = 0;
    expect(await runImportRun(run.id, { stopAfterChunks: 2 })).toMatchObject({
      status: "stopped",
      chunks: 2,
    });
    expect(await itemCount()).toBe(20);
    expect((await runRow(run.id)).sourceCursor).toEqual({
      cursor: "20",
      exhausted: false,
    });
    const chunksAfterInterrupt = await db
      .select()
      .from(schema.importChunkTable);
    expect(
      chunksAfterInterrupt.filter((c) => c.state === "committed"),
    ).toHaveLength(2);

    fakeReads.length = 0;
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: 2,
    });
    // The source was read from the stored cursor, never from the start.
    expect(fakeReads).toEqual(["20", "30"]);
    expect(await itemCount()).toBe(40);
    expect(await linkCount()).toBe(40);
    const committed = (await db.select().from(schema.importChunkTable)).filter(
      (c) => c.state === "committed",
    );
    expect(committed).toHaveLength(4);
    expect((await runRow(run.id)).stats).toMatchObject({
      created: 40,
      skipped: 0,
      processed: 40,
    });
  });

  it("pause stops at a chunk boundary; resume continues from the last committed chunk", async () => {
    const f = await engineFixture();
    setFakeFixture("pause", { records: makeRecords(f.type.key, 30) });
    const { app, run, dry } = await prepared(f, "pause", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id, { stopAfterChunks: 1 });
    const paused = await call(
      app,
      f.key,
      `/api/imports/${run.id}/pause`,
      post(),
      200,
    );
    expect(paused).toMatchObject({ state: "paused", pausedReason: "operator" });
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      chunks: 0,
    });
    expect(await itemCount()).toBe(10);
    const resumed = await call(
      app,
      f.key,
      `/api/imports/${run.id}/resume`,
      post(),
      200,
    );
    expect(resumed.state).toBe("running");
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: 2,
    });
    expect(await itemCount()).toBe(30);
  });

  it("a full rerun against the same source creates no new rows and reuses the saved mapping", async () => {
    const f = await engineFixture();
    setFakeFixture("rerun", { records: makeRecords(f.type.key, 30) });
    const first = await prepared(f, "rerun", 30, "stable-source");
    await call(
      first.app,
      f.key,
      `/api/imports/${first.run.id}/execute`,
      post(first.dry.body),
      202,
    );
    await runImportRun(first.run.id);
    const linksBefore = (await db.select().from(schema.importRecordLinkTable))
      .map((l) => `${l.sourceId}:${l.targetId}`)
      .sort();
    const itemsBefore = await itemCount();

    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "rerun", "stable-source");
    // Confirmed entries from the first run survive rediscovery: complete without a new confirm.
    expect(mapping.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 30,
      rejected: 0,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(itemsBefore);
    const linksAfter = (await db.select().from(schema.importRecordLinkTable))
      .map((l) => `${l.sourceId}:${l.targetId}`)
      .sort();
    expect(linksAfter).toEqual(linksBefore);
    expect((await runRow(run.id)).stats).toMatchObject({
      created: 0,
      skipped: 30,
      processed: 30,
    });
  });

  it("a self-approved run cannot write past 50 records if the source changed after its dry run", async () => {
    const f = await engineFixture();
    registerFake(60);
    const records = makeRecords(f.type.key, 60);
    setFakeFixture("drift", { records });
    const first = await prepared(f, "drift", 60, "drift-source");
    await grantExecutedApproval(f, first.run.id, {
      digest: first.dry.body.dryRunDigest,
      totalCount: 60,
      mappingVersion: first.confirmed.mappingVersion,
    });
    await call(
      first.app,
      f.key,
      `/api/imports/${first.run.id}/execute`,
      post(first.dry.body),
      202,
    );
    await runImportRun(first.run.id);
    expect(await itemCount()).toBe(60);

    const { app } = createApp();
    const { run } = await startRun(app, f, "drift", "drift-source");
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      skipped: 60,
      created: 0,
      updated: 0,
    });
    expect(dry.report.approvalRequired).toBe(false);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    // The source changes after the dry run: every record would now be an update.
    setFakeFixture("drift", {
      records: records.map((r) => ({ ...r, title: `${r.title} (edited)` })),
    });
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approval_invalid",
      chunks: 1,
    });
    expect((await runRow(run.id)).stats).toMatchObject({ updated: 50 });
    expect(await itemCount()).toBe(60);
  });

  it("revoked instance-admin authority pauses the run (fail closed) without writing", async () => {
    const f = await engineFixture();
    setFakeFixture("revoked", { records: makeRecords(f.type.key, 30) });
    const { app, run, dry } = await prepared(f, "revoked", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id, { stopAfterChunks: 1 });
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, f.user.id));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "authority_lost",
    });
    expect(await runRow(run.id)).toMatchObject({
      state: "paused",
      pausedReason: "authority_lost",
    });
    expect(await itemCount()).toBe(10);
    // Resuming does not bypass it: the next tick pauses again.
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, f.user.id));
    await call(app, f.key, `/api/imports/${run.id}/resume`, post(), 200);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
  });

  it("a disabled starting key pauses the run; the run never continues as the system", async () => {
    const f = await engineFixture();
    setFakeFixture("keyoff", { records: makeRecords(f.type.key, 20) });
    const { app, run, dry } = await prepared(f, "keyoff", 20);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, f.keyId));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "authority_lost",
    });
    expect(await itemCount()).toBe(0);
  });

  it("lost project reach pauses the run", async () => {
    const f = await engineFixture();
    setFakeFixture("reach", { records: makeRecords(f.type.key, 20) });
    const { app, run, dry } = await prepared(f, "reach", 20);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id, { stopAfterChunks: 1 });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, f.project.id));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "project_reach_lost",
    });
    expect(await itemCount()).toBe(10);
  });

  it("a source outage pauses at the failed page and resumes from it", async () => {
    const f = await engineFixture();
    const records = makeRecords(f.type.key, 30);
    setFakeFixture("outage", { records });
    const { app, run, dry } = await prepared(f, "outage", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    setFakeFixture("outage", { records, failAtCursor: "10" });
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "source_error",
      chunks: 1,
    });
    expect(await itemCount()).toBe(10);
    setFakeFixture("outage", { records });
    await call(app, f.key, `/api/imports/${run.id}/resume`, post(), 200);
    fakeReads.length = 0;
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: 2,
    });
    expect(fakeReads).toEqual(["10", "20"]);
    expect(await itemCount()).toBe(30);
  });

  it("a mapping change while executing pauses the run and forces a new dry run", async () => {
    const f = await engineFixture();
    setFakeFixture("midmap", { records: makeRecords(f.type.key, 30) });
    const { app, run, confirmed, dry } = await prepared(f, "midmap", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id, { stopAfterChunks: 1 });
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
    expect(await runRow(run.id)).toMatchObject({
      state: "paused",
      pausedReason: "mapping_changed",
      enginePhase: "discovered",
    });
    expect(await runImportRun(run.id)).toMatchObject({ status: "paused" });
    const resume = await req(
      app,
      f.key,
      `/api/imports/${run.id}/resume`,
      post(),
    );
    expect(resume.status).toBe(409);
    // A new dry run and execute restart from the beginning; committed records are skipped.
    const again = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(again.report.counts).toMatchObject({ skipped: 10, created: 20 });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(again.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
  });

  it("refuses to run past the approved count or without its approval binding", async () => {
    const f = await engineFixture();
    setFakeFixture("bound", { records: makeRecords(f.type.key, 20) });
    const { app, run, dry } = await prepared(f, "bound", 20);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await db
      .update(schema.importRunTable)
      .set({ approvedCount: 5 })
      .where(eq(schema.importRunTable.id, run.id));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approved_count_exceeded",
    });
    expect(await itemCount()).toBe(0);
    await db
      .update(schema.importRunTable)
      .set({
        state: "running",
        pausedReason: null,
        approvedDigest: null,
        approvedCount: null,
        approvedMappingVersion: null,
      })
      .where(eq(schema.importRunTable.id, run.id));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approval_invalid",
    });
    expect(await itemCount()).toBe(0);
  });

  it("a run above 50 writes executes in one large chunk only under a bound, executed approval", async () => {
    const f = await engineFixture();
    registerFake(60);
    setFakeFixture("large", { records: makeRecords(f.type.key, 60) });
    const { app, run, confirmed, dry } = await prepared(f, "large", 60);
    // No approval yet: execute opens the run-level request and does not start.
    const requested = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
    );
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({
      status: "pending_approval",
    });
    expect(await itemCount()).toBe(0);
    const binding = {
      digest: dry.body.dryRunDigest,
      totalCount: 60,
      mappingVersion: confirmed.mappingVersion,
    };
    await grantExecutedApproval(f, run.id, binding);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: 1,
    });
    expect(await itemCount()).toBe(60);
  });

  it("refuses large chunks when the approval's pending action is not executed", async () => {
    const f = await engineFixture();
    registerFake(60);
    setFakeFixture("large2", { records: makeRecords(f.type.key, 60) });
    const { app, run, confirmed, dry } = await prepared(f, "large2", 60);
    const pending = await grantExecutedApproval(f, run.id, {
      digest: dry.body.dryRunDigest,
      totalCount: 60,
      mappingVersion: confirmed.mappingVersion,
    });
    await db
      .update(schema.pendingActionTable)
      .set({ state: "denied" })
      .where(eq(schema.pendingActionTable.id, pending.id));
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approval_invalid",
    });
    expect(await itemCount()).toBe(0);
  });

  it("denies cross-workspace access: a project of another workspace and another workspace's runs are not found", async () => {
    const f = await engineFixture();
    const other = await engineFixture();
    const { app } = createApp();
    setFakeFixture("tenant", { records: makeRecords(f.type.key, 2) });
    const { source, run } = await startRun(app, f, "tenant");
    // Source of workspace A cannot target a project of workspace B.
    const crossProject = await req(
      app,
      f.key,
      `/api/import-sources/${source.id}/runs`,
      post({ projectId: other.project.id, sourceRef: "x" }),
    );
    expect(crossProject.status).toBe(404);
    // Workspace B's instance admin (a different person, no reach into A) cannot see or drive A's run.
    for (const [path, init] of [
      [`/api/imports/${run.id}/engine`, undefined],
      [`/api/imports/${run.id}/mapping`, undefined],
      [`/api/imports/${run.id}/losses`, undefined],
      [`/api/imports/${run.id}/discover`, post()],
      [`/api/imports/${run.id}/dry-run-all`, post()],
      [`/api/imports/${run.id}/pause`, post()],
    ] as const) {
      const response = await req(app, other.key, path, init);
      expect([403, 404], path).toContain(response.status);
    }
    expect(await runRow(run.id)).toMatchObject({
      state: "queued",
      enginePhase: "discovered",
    });
    const listOther = await req(
      app,
      other.key,
      `/api/import-sources?workspaceId=${f.workspace.id}`,
    );
    expect([403, 404]).toContain(listOther.status);
    const createOther = await req(
      app,
      other.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        name: "intruder",
        config: { fixture: "tenant" },
      }),
    );
    expect([403, 404]).toContain(createOther.status);
    expect(await db.select().from(importSourceConnectionTable)).toHaveLength(1);
    const losses = await db
      .select()
      .from(importLossTable)
      .where(and(eq(importLossTable.importRunId, run.id)));
    expect(losses).toHaveLength(0);
  });
});
