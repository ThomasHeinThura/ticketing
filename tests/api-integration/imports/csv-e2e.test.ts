import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import {
  importLossTable,
  importSourceConnectionTable,
} from "../../../apps/api/src/database/schema-imports";
import { genericCsvProfile } from "../../../apps/api/src/imports/adapters/csv";
import { createCsvFamilyAdapter } from "../../../apps/api/src/imports/adapters/csv/core";
import {
  registerImportAdapter,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  type App,
  call,
  dryRunAndExecuteBody,
  engineFixture,
  grantExecutedApproval,
  post,
  req,
  runRow,
} from "./engine-helpers";

const csvText = readFileSync(
  resolve(__dirname, "../../fixtures/imports/csv/issues.csv"),
  "utf8",
);
const PAGE = 20;
// 67 data rows: 62 valid + duplicate id + empty title + empty state + empty type + ragged row
const ROWS = 67;

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  registerImportAdapter("import.csv", () =>
    createCsvFamilyAdapter(genericCsvProfile, PAGE),
  );
});
afterEach(() => unregisterImportAdapter("import.csv"));

type F = Awaited<ReturnType<typeof engineFixture>>;

async function startCsvRun(
  app: App,
  f: F,
  config: Record<string, unknown> = { csvText },
  name = "issues.csv",
  sourceRef = "issues.csv",
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId: "import.csv",
      name,
      config,
    }),
    200,
  );
  const run = await call(
    app,
    f.key,
    `/api/import-sources/${source.id}/runs`,
    post({ projectId: f.project.id, sourceRef }),
    200,
  );
  const mapping = await call(
    app,
    f.key,
    `/api/imports/${run.id}/discover`,
    post(),
    200,
  );
  return { source, run, mapping };
}

/** The operator's decisions: types to the project type, the unknown state to "started", extras ignored. */
async function confirmMapping(
  app: App,
  f: F,
  runId: string,
  mapping: { mappingVersion: number; entries: Array<Record<string, unknown>> },
) {
  const edits = mapping.entries
    .filter((e) => e.target === null)
    .map((e) => {
      const domain = e.domain as string;
      const target =
        domain === "type"
          ? { kind: "target", id: f.type.id }
          : domain === "state"
            ? { kind: "group", group: "started" }
            : { kind: "ignore" };
      return { domain, value: e.value, target };
    });
  // type values that were proposed against a different type id are re-pointed to this project's type
  for (const e of mapping.entries)
    if (e.domain === "type" && e.target !== null)
      edits.push({
        domain: "type",
        value: e.value,
        target: { kind: "target", id: f.type.id },
      });
  return call(
    app,
    f.key,
    `/api/imports/${runId}/mapping`,
    post({
      expectedMappingVersion: mapping.mappingVersion,
      entries: edits,
      confirmProposals: true,
    }),
    200,
  );
}

async function prepared(app: App, f: F, name?: string) {
  // one logical file: every rerun keeps the same sourceRef, only the connection name differs
  const { source, run, mapping } = await startCsvRun(app, f, { csvText }, name);
  const confirmed = await confirmMapping(app, f, run.id, mapping);
  expect(confirmed.completeness.complete).toBe(true);
  const dry = await dryRunAndExecuteBody(app, f.key, run.id);
  return { source, run, mapping, dry };
}

const items = async () => db.select().from(schema.workItemTable);
const links = async () => db.select().from(schema.importRecordLinkTable);

describe("csv import end to end", () => {
  it("create source, discover, confirm mapping, dry-run, execute: items match the reconciled counts", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { source, run, mapping, dry } = await prepared(app, f);

    // the credential is absent and the secret-free config is the only transport
    expect(source).toMatchObject({
      pluginId: "import.csv",
      hasCredential: false,
    });
    expect(mapping.discovery.totalRecords).toBe(ROWS);
    const stateEntries = mapping.entries
      .filter((e: { domain: string }) => e.domain === "state")
      .map((e: { value: string }) => e.value);
    expect(stateEntries).toContain("Waiting for vendor");

    const report = dry.report;
    expect(report.counts.processed).toBe(ROWS);
    // duplicate id, empty title, empty state, empty type and the ragged row (no type/state) are rejected
    expect(report.counts.rejected).toBe(5);
    expect(report.counts.created).toBe(ROWS - 5);
    expect(report.rejectionCodes).toMatchObject({
      duplicate_source_id: 1,
      missing_title: 1,
      missing_state: 1,
      missing_type: 2,
    });

    // 62 creations exceed the approval threshold: approval is required and bound to the digest
    const blocked = await req(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
    );
    // The request is opened (pending approval); nothing runs until it is approved.
    expect(await blocked.json()).toMatchObject({ status: "pending_approval" });
    await grantExecutedApproval(f, run.id, {
      digest: dry.body.dryRunDigest,
      totalCount: dry.body.totalCount,
      mappingVersion: dry.body.mappingVersion,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: Math.ceil(ROWS / PAGE),
    });

    const created = ROWS - 5;
    expect(await items()).toHaveLength(created);
    expect(await links()).toHaveLength(created);
    const done = await runRow(run.id);
    expect(done).toMatchObject({
      state: "completed",
      enginePhase: "completed",
    });
    expect(done.stats).toMatchObject({
      created,
      processed: ROWS,
      rejected: 5,
    });

    const titles = (await items()).map((i) => i.title);
    expect(titles).toContain('Fix "login" bug, again');
    expect(titles).toContain("Überprüfung der Zahlungs-API 日本語 ✅");
    const six = (await items()).find((i) => i.title === "Imported item 6");
    expect(JSON.stringify(six?.description ?? "")).toContain(
      "Line two with, comma",
    );
  });

  it("invalid rows appear in the loss report with fixed codes and no free text", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run, dry } = await prepared(app, f);
    await grantExecutedApproval(f, run.id, {
      digest: dry.body.dryRunDigest,
      totalCount: dry.body.totalCount,
      mappingVersion: dry.body.mappingVersion,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    await runImportRun(run.id);

    const losses = await call(
      app,
      f.key,
      `/api/imports/${run.id}/losses?limit=200`,
      undefined,
      200,
    );
    const count = (code: string, detail?: string) =>
      losses.summary.find(
        (s: { code: string; detailCode?: string | null }) =>
          s.code === code && (detail === undefined || s.detailCode === detail),
      )?.count ?? 0;
    expect(count("invalid_date", "created_at")).toBe(1);
    expect(count("invalid_date", "due_date")).toBe(1);
    expect(count("invalid_email", "assignee")).toBe(1);
    expect(count("parent_not_found")).toBe(1);
    expect(count("parent_self_reference")).toBe(1);
    expect(count("duplicate_source_id")).toBe(1);
    expect(count("row_column_count_mismatch")).toBe(1);
    expect(count("column_ignored", "sprint_notes")).toBeGreaterThan(0);
    // the first engine reject code per row: duplicate + empty title, empty state, empty type + ragged
    expect(count("record_rejected", "duplicate_source_id")).toBe(1);
    expect(count("record_rejected", "missing_title")).toBe(1);
    expect(count("record_rejected", "missing_state")).toBe(1);
    expect(count("record_rejected", "missing_type")).toBe(2);
    for (const row of await db
      .select()
      .from(importLossTable)
      .where(eq(importLossTable.importRunId, run.id)))
      expect(row.code).toMatch(/^[a-z][a-z0-9_]{1,63}$/u);
    // the duplicate row did not overwrite or merge into the first T-004
    const original = (await links()).filter((l) => l.sourceId === "T-004");
    expect(original).toHaveLength(1);
  });

  it("a rerun of the same file creates 0 duplicates", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const first = await prepared(app, f, "issues-first.csv");
    await grantExecutedApproval(f, first.run.id, {
      digest: first.dry.body.dryRunDigest,
      totalCount: first.dry.body.totalCount,
      mappingVersion: first.dry.body.mappingVersion,
    });
    await call(
      app,
      f.key,
      `/api/imports/${first.run.id}/execute`,
      post(first.dry.body),
      202,
    );
    await runImportRun(first.run.id);
    const before = (await items()).length;
    expect(before).toBe(ROWS - 5);

    const second = await prepared(app, f, "issues-second.csv");
    expect(second.dry.report.counts.created).toBe(0);
    expect(second.dry.report.counts.skipped).toBe(ROWS - 5);
    expect(second.dry.report.counts.updated).toBe(0);
    await call(
      app,
      f.key,
      `/api/imports/${second.run.id}/execute`,
      post(second.dry.body),
      202,
    );
    await runImportRun(second.run.id);
    expect(await items()).toHaveLength(before);
    expect(await links()).toHaveLength(before);
  });

  it("kill after chunk 2 then resume continues from the stored row cursor", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run, dry } = await prepared(app, f);
    await grantExecutedApproval(f, run.id, {
      digest: dry.body.dryRunDigest,
      totalCount: dry.body.totalCount,
      mappingVersion: dry.body.mappingVersion,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id, { stopAfterChunks: 2 })).toMatchObject({
      status: "stopped",
      chunks: 2,
    });
    expect((await runRow(run.id)).sourceCursor).toEqual({
      cursor: String(PAGE * 2),
      exhausted: false,
    });
    const midway = (await items()).length;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(ROWS - 5);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await items()).toHaveLength(ROWS - 5);
    const sourceIds = (await links()).map((l) => l.sourceId);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it("a malformed file is refused when the source is created with no partial import", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.csv",
        name: "broken.csv",
        config: { csvText: 'external_id,title\n1,"never closed' },
      }),
    );
    // The connect check refuses it at creation with a fixed reason; nothing is stored or imported.
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      reason: "unterminated_quote",
    });
    expect(await items()).toHaveLength(0);
  });

  it("secret-like config keys are refused (the csv text is the only content in config)", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.csv",
        name: "secretive",
        config: { csvText, apiKey: "nope" },
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.select().from(importSourceConnectionTable)).toHaveLength(0);
  });

  it("a non-admin is denied every step", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const { run } = await startCsvRun(app, f);
    const member = await createWorkspaceMember({ role: "member" });
    const key = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "member key",
        capabilities: ["work_item:create", "work_item:read"],
        isMcp: true,
      },
    );
    for (const [path, init] of [
      [
        "/api/import-sources",
        post({
          workspaceId: f.workspace.id,
          pluginId: "import.csv",
          name: "x",
          config: { csvText },
        }),
      ],
      [`/api/import-sources?workspaceId=${f.workspace.id}`, undefined],
      [`/api/imports/${run.id}/discover`, post()],
      [`/api/imports/${run.id}/mapping`, undefined],
      [`/api/imports/${run.id}/dry-run-all`, post()],
      [
        `/api/imports/${run.id}/execute`,
        post({
          dryRunDigest: "0".repeat(64),
          mappingVersion: 1,
          totalCount: 1,
        }),
      ],
      [`/api/imports/${run.id}/losses`, undefined],
    ] as const) {
      const response = await req(app, key.key, path, init);
      expect([401, 403, 404], path).toContain(response.status);
    }
    expect(await items()).toHaveLength(0);
    expect(
      await db
        .select()
        .from(importSourceConnectionTable)
        .where(and(eq(importSourceConnectionTable.name, "x"))),
    ).toHaveLength(0);
  });
});
