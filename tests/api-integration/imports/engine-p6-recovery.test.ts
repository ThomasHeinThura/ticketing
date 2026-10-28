/**
 * P6 round-1 engine fixes: recovery from each pause reason (R1-02), the executing administrator as
 * the acting identity (R1-14), the instance-admin lock held only for the short authority gate
 * (R1-15), person targets limited to the run's organisation (R1-16) and unreadable source items
 * reported as losses end to end (R1-10).
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importLossTable } from "../../../apps/api/src/database/schema-imports";
import {
  unreadableRecord,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { lockInstanceAdminSerialization } from "../../../apps/api/src/instance/users/repository";
import { resetTestDatabase } from "../helpers/database";
import { grantWorkItemProjectAccess, requireRow } from "../helpers/fixtures";
import { addMember } from "../helpers/reach-world";
import {
  type App,
  call,
  confirmAll,
  dryRunAndExecuteBody,
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

type F = Awaited<ReturnType<typeof engineFixture>>;

async function personOf(userId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId)),
    "person",
  );
}

/** A second instance administrator with reach into the same project and a full key. */
async function secondAdmin(f: F) {
  const { user, personId } = await addMember(f.workspace.id, "owner");
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, user.id));
  await grantWorkItemProjectAccess(user.id, f.project.id);
  const key = await createPersonalApiKey(
    { userId: user.id },
    {
      name: "second admin MCP",
      capabilities: [
        "instance:admin",
        "work_item:create",
        "work_item:read",
        "work_item:update",
      ],
      isMcp: true,
    },
  );
  return { user, personId, key: key.key };
}

async function prepared(f: F, id: string, count: number) {
  const { app } = createApp();
  const { run, mapping } = await startRun(app, f, id);
  await confirmAll(app, f.key, run.id, mapping.mappingVersion);
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  expect(dry.report.counts.processed).toBe(count);
  return { app, run, dry };
}

const itemCount = async () =>
  (await db.select().from(schema.workItemTable)).length;
const linkCount = async () =>
  (await db.select().from(schema.importRecordLinkTable)).length;

async function runAudits(runId: string) {
  const rows = await db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityType, "import_run"),
        eq(schema.auditLogTable.entityId, runId),
      ),
    );
  return rows.map((row) => row.after as Record<string, unknown>);
}

/** Return-to-dry-run recovery, then a fresh execute that completes without duplicates. */
async function recoverThroughDryRun(
  app: App,
  key: string,
  runId: string,
  expected: { skipped: number; created: number },
  executeKey = key,
) {
  const resume = await req(app, key, `/api/imports/${runId}/resume`, post());
  expect(resume.status).toBe(409);
  const again = await dryRunAndExecuteBody(app, key, runId);
  expect(again.report.counts).toMatchObject({ ...expected, rejected: 0 });
  // The return cleared the approval and left execution: a fresh dry run binds a fresh execute.
  const row = await runRow(runId);
  expect(row).toMatchObject({
    state: "queued",
    pausedReason: null,
    enginePhase: "dry_run_ready",
    approvedDigest: null,
  });
  await call(
    app,
    executeKey,
    `/api/imports/${runId}/execute`,
    post(again.body),
    202,
  );
  expect(await runImportRun(runId)).toMatchObject({ status: "completed" });
}

describe("recovery from a pause (P6-R1-02)", () => {
  it("approved_count_exceeded: the source grew; return to dry run, re-approve, finish without duplicates", async () => {
    const f = await engineFixture();
    const records = makeRecords(f.type.key, 40);
    setFakeFixture("grew", { records: records.slice(0, 30) });
    const { app, run, dry } = await prepared(f, "grew", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    // The source gains ten records after the dry run was approved for thirty.
    setFakeFixture("grew", { records });
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approved_count_exceeded",
    });
    expect(await itemCount()).toBe(30);
    // The dry run is the recovery; resume alone is refused (it would pause again).
    const accepted = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      post(),
      202,
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      job: { kind: "dry_run", status: "running" },
      run: { state: "queued", phase: "discovered", pausedReason: null },
    });
    await recoverThroughDryRun(app, f.key, run.id, {
      skipped: 30,
      created: 10,
    });
    expect(await itemCount()).toBe(40);
    expect(await linkCount()).toBe(40);
    const returned = (await runAudits(run.id)).find(
      (a) => a.operation === "dry_run_started" && a.returnedToSetup === true,
    );
    expect(returned).toMatchObject({
      pausedReason: "approved_count_exceeded",
    });
  });

  it("approval_invalid: return to dry run, re-approve, finish; committed chunks stay committed", async () => {
    const f = await engineFixture();
    const b = await secondAdmin(f);
    const a = await personOf(f.user.id);
    setFakeFixture("stale", { records: makeRecords(f.type.key, 30) });
    const { app, run, dry } = await prepared(f, "stale", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id, { stopAfterChunks: 1 });
    // The approval stops matching the dry run it was granted for.
    await db
      .update(schema.importRunTable)
      .set({ approvedDigest: "f".repeat(64) })
      .where(eq(schema.importRunTable.id, run.id));
    expect(await runImportRun(run.id)).toMatchObject({
      status: "paused",
      pausedReason: "approval_invalid",
    });
    expect(await itemCount()).toBe(10);
    const committedBefore = (
      await db.select().from(schema.importChunkTable)
    ).filter((c) => c.state === "committed");
    expect(committedBefore).toHaveLength(1);
    // B re-executes after the return: B is the new executor, A stays the creator of record.
    await recoverThroughDryRun(
      app,
      f.key,
      run.id,
      { skipped: 10, created: 20 },
      b.key,
    );
    expect(await itemCount()).toBe(30);
    const executions = (await runAudits(run.id)).filter(
      (x) => x.operation === "executing",
    );
    expect(executions).toHaveLength(2);
    expect(executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          createdByPersonId: a.id,
          executedByPersonId: a.id,
        }),
        expect.objectContaining({
          previousExecutorPersonId: a.id,
          executedByPersonId: b.personId,
        }),
      ]),
    );
    expect(executions.filter((x) => "createdByPersonId" in x)).toHaveLength(1);
    expect(await linkCount()).toBe(30);
    const committed = (await db.select().from(schema.importChunkTable)).filter(
      (c) => c.state === "committed",
    );
    expect(committed.map((c) => c.id)).toEqual(
      expect.arrayContaining(committedBefore.map((c) => c.id)),
    );
  });

  it("authority_lost: another instance administrator takes the run over and it continues as them", async () => {
    const f = await engineFixture();
    const b = await secondAdmin(f);
    const a = await personOf(f.user.id);
    setFakeFixture("handover", { records: makeRecords(f.type.key, 30) });
    const { app, run, dry } = await prepared(f, "handover", 30);
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
    // The demoted starter cannot resume it; another administrator can.
    const refused = await req(
      app,
      f.key,
      `/api/imports/${run.id}/resume`,
      post(),
    );
    expect([403, 404]).toContain(refused.status);
    const resumed = await call(
      app,
      b.key,
      `/api/imports/${run.id}/resume`,
      post(),
      200,
    );
    expect(resumed.state).toBe("running");
    expect((await runRow(run.id)).startedBy).toBe(b.personId);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(30);
    // The rest of the import is written as B; A wrote the first chunk.
    const created = await db
      .select({ actorId: schema.activityTable.actorId })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "created"));
    // (activity rows name the acting user)
    expect(created.filter((r) => r.actorId === f.user.id)).toHaveLength(10);
    expect(created.filter((r) => r.actorId === b.user.id)).toHaveLength(20);
    const resumedAudit = (await runAudits(run.id)).find(
      (x) => x.operation === "resumed",
    );
    expect(resumedAudit).toMatchObject({
      pausedReason: "authority_lost",
      previousExecutorPersonId: a.id,
      executedByPersonId: b.personId,
    });
  });
});

describe("the executing administrator is the acting identity (P6-R1-14)", () => {
  it("binds started_by at execute, writes as the executor and audits creator and executor", async () => {
    const f = await engineFixture();
    const b = await secondAdmin(f);
    const a = await personOf(f.user.id);
    setFakeFixture("exec-by-b", { records: makeRecords(f.type.key, 20) });
    // A creates, discovers, maps and dry-runs; B executes.
    const { app, run, dry } = await prepared(f, "exec-by-b", 20);
    expect((await runRow(run.id)).startedBy).toBe(a.id);
    await call(
      app,
      b.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect((await runRow(run.id)).startedBy).toBe(b.personId);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    const created = await db
      .select({ actorId: schema.activityTable.actorId })
      .from(schema.activityTable)
      .where(eq(schema.activityTable.verb, "created"));
    expect(created).toHaveLength(20);
    // (activity rows name the acting user)
    expect(new Set(created.map((r) => r.actorId))).toEqual(
      new Set([b.user.id]),
    );
    const executing = (await runAudits(run.id)).find(
      (x) => x.operation === "executing",
    );
    expect(executing).toMatchObject({
      createdByPersonId: a.id,
      executedByPersonId: b.personId,
    });
  });
});

describe("the instance-admin lock is held only for the authority gate (P6-R1-15)", () => {
  it("an administrator change during a chunk is not blocked, and the revoked executor stops at the next chunk", async () => {
    const f = await engineFixture();
    setFakeFixture("midchunk", { records: makeRecords(f.type.key, 30) });
    const { app, run, dry } = await prepared(f, "midchunk", 30);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    let changeMs = -1;
    let calls = 0;
    const outcome = await runImportRun(run.id, {
      duringChunk: async () => {
        calls += 1;
        if (calls !== 1) return;
        // An instance-admin change takes the lock EXCLUSIVELY. With the chunk still open it must
        // get it at once; the lock timeout turns a wait into a failure of this test.
        const started = Date.now();
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
          await lockInstanceAdminSerialization(tx);
          await tx
            .update(schema.userTable)
            .set({ role: "user" })
            .where(eq(schema.userTable.id, f.user.id));
        });
        changeMs = Date.now() - started;
      },
    });
    expect(changeMs).toBeGreaterThanOrEqual(0);
    expect(changeMs).toBeLessThan(2000);
    // The in-flight chunk had passed its gate; the next chunk's gate sees the revocation (fail closed).
    expect(outcome).toMatchObject({
      status: "paused",
      pausedReason: "authority_lost",
    });
    expect(await itemCount()).toBe(10);
    expect(await runRow(run.id)).toMatchObject({
      state: "paused",
      pausedReason: "authority_lost",
      sourceCursor: { cursor: "10", exhausted: false },
    });
  });
});

describe("person targets stay inside the run's organisation (P6-R1-16)", () => {
  it("refuses a person id of another organisation with 422 and accepts the organisation's own staff", async () => {
    const f = await engineFixture();
    const email = "assignee@source.example.test";
    setFakeFixture("people", {
      records: makeRecords(f.type.key, 3).map((r) => ({
        ...r,
        assigneeEmail: email,
      })),
    });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "people");
    expect(
      (mapping.entries as Array<{ domain: string; value: string }>).some(
        (e) => e.domain === "person" && e.value === email,
      ),
    ).toBe(true);
    const other = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `other-${randomUUID()}`,
          name: "Other organisation",
          isInternal: false,
          active: true,
          portalAccess: true,
        })
        .returning(),
      "other organisation",
    );
    const foreign = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: other.id,
          side: "staff",
          displayName: "Someone else's staff",
        })
        .returning(),
      "foreign person",
    );
    const edit = (id: string) =>
      post({
        expectedMappingVersion: mapping.mappingVersion,
        entries: [
          { domain: "person", value: email, target: { kind: "target", id } },
        ],
      });
    const refused = await req(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      edit(foreign.id),
    );
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain(
      "mapping_person_not_in_organisation",
    );
    const unknown = await req(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      edit(`person-${randomUUID()}`),
    );
    expect(unknown.status).toBe(422);
    const own = await personOf(f.user.id);
    const saved = await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      edit(own.id),
      200,
    );
    expect(
      (
        saved.entries as Array<{
          domain: string;
          value: string;
          target: { id?: string } | null;
        }>
      ).find((e) => e.domain === "person" && e.value === email)?.target,
    ).toMatchObject({ id: own.id });
  });
});

describe("unreadable source items are reported, never dropped (P6-R1-10)", () => {
  it("discovery counts them, the dry run rejects them by code and the run records their losses", async () => {
    const f = await engineFixture();
    setFakeFixture("lossy", {
      records: [
        ...makeRecords(f.type.key, 3),
        unreadableRecord({
          sourceType: "issue",
          sourceId: "SRC-404",
          code: "unreadable_item",
        }),
        unreadableRecord({
          sourceType: "issue",
          sourceId: "SRC-405",
          code: "missing_title",
        }),
      ],
    });
    const { app } = createApp();
    const { run, mapping } = await startRun(app, f, "lossy");
    expect(mapping.discovery).toMatchObject({
      totalRecords: 5,
      unreadable: { unreadable_item: 1, missing_title: 1 },
    });
    await confirmAll(app, f.key, run.id, mapping.mappingVersion);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      processed: 5,
      created: 3,
      rejected: 2,
    });
    expect(dry.report.rejectionCodes).toEqual({
      unreadable_item: 1,
      missing_title: 1,
    });
    expect(dry.report.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "record_rejected",
          detailCode: "unreadable_item",
          count: 1,
        }),
        expect.objectContaining({
          code: "record_rejected",
          detailCode: "missing_title",
          count: 1,
        }),
      ]),
    );
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(3);
    const losses = await db
      .select()
      .from(importLossTable)
      .where(eq(importLossTable.importRunId, run.id));
    expect(
      losses
        .filter((l) => l.code === "record_rejected")
        .map((l) => `${l.sourceId}:${l.detailCode}`)
        .sort(),
    ).toEqual(["SRC-404:unreadable_item", "SRC-405:missing_title"]);
  });
});
