import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { unregisterImportAdapter } from "../../../apps/api/src/imports/engine/adapter";
import { setImportEngineAutoStart } from "../../../apps/api/src/imports/engine/runner";
import { grantRunApproval } from "../../../apps/api/src/imports/engine/service";
import { clearFakeFixtures } from "../../../apps/api/src/imports/engine/test-adapter";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  call,
  confirmAll,
  dryRunAndExecuteBody,
  dryRunAndWait,
  engineFixture,
  makeRecords,
  post,
  registerFake,
  req,
  requestPending,
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

describe("import engine mapping gate", () => {
  it("an unmapped state blocks execute; mapping it unblocks, and the dry run still reports it", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const records = makeRecords(f.type.key, 6, {
      state: (i) => (i === 5 ? "Weird" : "Backlog"),
    });
    setFakeFixture("gate", { records });
    const { run, mapping } = await startRun(app, f, "gate");
    // Proposals alone are not executable and an unmapped value is not guessed.
    expect(mapping.completeness).toMatchObject({
      complete: false,
      unmapped: 1,
    });
    expect(mapping.completeness.stateGroups).toHaveProperty("cancelled");
    const confirmed = await confirmAll(
      app,
      f.key,
      run.id,
      mapping.mappingVersion,
    );
    expect(confirmed.completeness).toMatchObject({
      complete: false,
      unmapped: 1,
      proposed: 0,
    });

    const { report, body } = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(report.complete).toBe(false);
    expect(report.counts).toMatchObject({
      created: 5,
      rejected: 1,
      processed: 6,
    });
    expect(report.rejectionCodes).toMatchObject({ unmapped_value: 1 });
    const blocked = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(body),
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.text()).toBe("Mapping is incomplete");
    expect((await runRow(run.id)).state).toBe("queued");

    const mapped = await call(
      app,
      f.key,
      `/api/imports/${run.id}/mapping`,
      post({
        expectedMappingVersion: confirmed.mappingVersion,
        entries: [
          {
            domain: "state",
            value: "Weird",
            target: { kind: "group", group: "started" },
          },
        ],
      }),
      200,
    );
    expect(mapped.completeness.complete).toBe(true);
    expect(mapped.mappingVersion).toBe(confirmed.mappingVersion + 1);
    // The earlier dry run bound the old mapping version and is gone.
    const stale = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(body),
    );
    expect(stale.status).toBe(409);
    expect(await stale.text()).toBe(
      "A current dry run is required before execution",
    );
    const fresh = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(fresh.report).toMatchObject({
      complete: true,
      counts: { created: 6, rejected: 0 },
    });
    const started = await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(fresh.body),
      202,
    );
    expect(started.status).toBe("started");
    expect((await runRow(run.id)).state).toBe("running");
  });

  it("a mapping change invalidates the dry run and the approval; the approval binds digest, count and version", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    setFakeFixture("approval", { records: makeRecords(f.type.key, 60) });
    const { run, mapping } = await startRun(app, f, "approval");
    const confirmed = await confirmAll(
      app,
      f.key,
      run.id,
      mapping.mappingVersion,
    );
    const { report, body } = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(report.approvalRequired).toBe(true);

    // Above 50 writes execute opens the run-level approval request instead of starting.
    const requested = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(body),
    );
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({
      status: "pending_approval",
    });

    const pending = await requestPending(f, run.id);
    // Wrong binding is refused: nothing becomes approved.
    for (const wrong of [
      {
        digest: "a".repeat(64),
        totalCount: 60,
        mappingVersion: confirmed.mappingVersion,
      },
      {
        digest: body.dryRunDigest,
        totalCount: 59,
        mappingVersion: confirmed.mappingVersion,
      },
      {
        digest: body.dryRunDigest,
        totalCount: 60,
        mappingVersion: confirmed.mappingVersion + 1,
      },
    ])
      await expect(
        db.transaction((tx) =>
          grantRunApproval(tx, {
            runId: run.id,
            pendingActionId: pending.id,
            ...wrong,
          }),
        ),
      ).rejects.toThrow();
    expect((await runRow(run.id)).approvedDigest).toBeNull();

    await db.transaction((tx) =>
      grantRunApproval(tx, {
        runId: run.id,
        pendingActionId: pending.id,
        digest: body.dryRunDigest,
        totalCount: 60,
        mappingVersion: confirmed.mappingVersion,
      }),
    );
    expect(await runRow(run.id)).toMatchObject({
      approvedDigest: body.dryRunDigest,
      approvedCount: 60,
      approvedMappingVersion: confirmed.mappingVersion,
    });

    // Any mapping change clears the dry run and the approval together.
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
      approvedDigest: null,
      approvedCount: null,
      approvedMappingVersion: null,
      approvalPendingActionId: null,
      engineDryRunDigest: null,
      enginePhase: "discovered",
    });
    // And the old binding can no longer start the run.
    const old = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(body),
    );
    expect(old.status).toBe(409);
  });

  it("whole-run dry run is deterministic, reports per-type counts, losses and broken cycles, and writes nothing", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const records = makeRecords(f.type.key, 4).map((record, index) => ({
      ...record,
      // 1 -> 2 -> 3 -> 1 is a cycle; 4 is a root.
      ...(index < 3 ? { parentSourceId: `SRC-${((index + 1) % 3) + 1}` } : {}),
      losses:
        index === 3
          ? [{ code: "attachment_too_large", detailCode: "over_limit" }]
          : [],
    }));
    setFakeFixture("report", { records });
    const { run, mapping } = await startRun(app, f, "report");
    await confirmAll(app, f.key, run.id, mapping.mappingVersion);
    const first = await dryRunAndWait(app, f.key, run.id);
    const second = await dryRunAndWait(app, f.key, run.id);
    expect(second.digest).toBe(first.digest);
    expect(first.byType.issue).toMatchObject({ created: 4, processed: 4 });
    expect(first.cycleBreaks).toBe(1);
    expect(first.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "issue",
          code: "parent_cycle_broken",
          count: 1,
        }),
        expect.objectContaining({
          code: "attachment_too_large",
          detailCode: "over_limit",
          count: 1,
        }),
      ]),
    );
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      0,
    );
    const stored = await call(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      undefined,
      200,
    );
    expect(stored.digest).toBe(first.digest);
  });

  it("never returns or stores a credential in plaintext", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    setFakeFixture("cred", { records: makeRecords(f.type.key, 1) });
    const { source } = await startRun(app, f, "cred");
    expect(JSON.stringify(source)).not.toContain("fixture-secret-credential");
    expect(source.hasCredential).toBe(true);
    const rows = await db.select().from(schema.importRunTable);
    expect(JSON.stringify(rows)).not.toContain("fixture-secret-credential");
    const stored = (await db.execute(
      // biome-ignore lint/suspicious/noExplicitAny: raw read of the credential column
      "SELECT credential_ciphertext FROM import_source_connection" as any,
    )) as unknown as { rows: Array<{ credential_ciphertext: string }> };
    expect(stored.rows[0]?.credential_ciphertext.startsWith("enc:v2:")).toBe(
      true,
    );
    const secretConfig = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        name: "bad",
        config: { apiToken: "x" },
      }),
    );
    expect(secretConfig.status).toBe(400);
  });
});
