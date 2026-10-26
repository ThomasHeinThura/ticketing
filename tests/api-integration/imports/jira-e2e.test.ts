/**
 * Jira / JSM adapters end to end through the engine routes, backed by recorded fixtures only
 * (an inline export, or recorded REST responses behind an injected GET-only transport).
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importSourceConnectionTable } from "../../../apps/api/src/database/schema-imports";
import { registerJiraAdapters } from "../../../apps/api/src/imports/adapters/jira";
import {
  getImportAdapter,
  type ImportSourceAdapter,
  type SourceRecord,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { createApp } from "../../../apps/api/src/index";
import {
  connection,
  loadFixture,
  noSleep,
  recordedTransport,
  TEST_CREDENTIAL,
  TEST_TOKEN,
} from "../../api/imports/adapters/jira-support";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  type App,
  call,
  dryRunAndExecuteBody,
  engineFixture,
  post,
  req,
  runRow,
} from "./engine-helpers";

type F = Awaited<ReturnType<typeof engineFixture>>;
// biome-ignore lint/suspicious/noExplicitAny: loose JSON bodies in assertions
type Json = Record<string, any>;

const jiraExport = loadFixture<Json>("jira/export.json");
const jsmExport = loadFixture<Json>("jsm/export.json");

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
});
afterEach(() => {
  unregisterImportAdapter("import.jira");
  unregisterImportAdapter("import.jsm");
});

async function seedStates(f: F) {
  for (const group of ["unstarted", "started", "completed", "cancelled"]) {
    const template = (
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: f.workspace.id,
          key: `jira-${group}-${randomUUID()}`,
          name: group,
          group: group as "started",
        })
        .returning()
    )[0];
    if (!template) throw new Error("state template");
    await db.insert(schema.stateTable).values({
      projectId: f.project.id,
      stateTemplateId: template.id,
      isDefault: false,
    });
  }
}

async function startRun(
  app: App,
  f: F,
  pluginId: "import.jira" | "import.jsm",
  config: Record<string, unknown>,
  sourceRef: string,
  credential?: string,
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId,
      name: `${sourceRef}-${randomUUID()}`,
      config,
      ...(credential ? { credential } : {}),
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

/** Confirms the adapter's proposals and maps everything it (correctly) left to the operator. */
async function confirmAndMapRest(app: App, f: F, runId: string, mapping: Json) {
  const entries = (mapping.entries as Json[])
    .filter((entry) => entry.target === null)
    .map((entry) => ({
      domain: entry.domain,
      value: entry.value,
      target:
        entry.domain === "type"
          ? { kind: "target", id: f.type.id }
          : entry.domain === "person"
            ? { kind: "placeholder" }
            : { kind: "ignore" },
    }));
  return call(
    app,
    f.key,
    `/api/imports/${runId}/mapping`,
    post({
      expectedMappingVersion: mapping.mappingVersion,
      entries,
      confirmProposals: true,
    }),
    200,
  );
}

async function readAllRecords(
  adapter: ImportSourceAdapter,
  config: Record<string, unknown>,
  credential: string | null,
  pluginId: "import.jira" | "import.jsm",
) {
  const conn = connection(pluginId, config, credential);
  const records: SourceRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await adapter.readPage(conn, cursor, 100);
    records.push(...page.records);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return records;
}

const itemCount = async () =>
  (await db.select().from(schema.workItemTable)).length;
const linkCount = async () =>
  (await db.select().from(schema.importRecordLinkTable)).length;

function lossTally(records: SourceRecord[]) {
  const tally = new Map<string, number>();
  for (const record of records)
    for (const loss of record.losses ?? []) {
      const key = `${loss.code}|${loss.detailCode ?? ""}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  return tally;
}

describe("jira export end to end", () => {
  it("discovers, maps, dry-runs, executes in chunks and reconciles counts and losses", async () => {
    const f = await engineFixture();
    await seedStates(f);
    const { transport } = recordedTransport();
    registerJiraAdapters({ transport, sleep: noSleep, chunkSize: 10 });
    const { app } = createApp();
    const config = {
      export: jiraExport,
      siteUrl: "https://acme-fixture.atlassian.net",
    };
    const { run, mapping } = await startRun(
      app,
      f,
      "import.jira",
      config,
      "acme-jira-export",
    );

    // Discovery: facets come from the source, never from a guess.
    expect(mapping.discovery).toMatchObject({ totalRecords: 32 });
    const entries = mapping.entries as Json[];
    const state = (value: string) =>
      entries.find((e) => e.domain === "state" && e.value === value);
    expect(state("Closed / Won't Do")).toMatchObject({
      status: "proposed",
      target: { kind: "group", group: "cancelled" },
    });
    expect(state("Done / Done")).toMatchObject({
      target: { kind: "group", group: "completed" },
    });
    // Labels, sprints and custom fields are left for the operator: execution is blocked until mapped.
    expect(mapping.completeness.complete).toBe(false);
    const blocked = await req(
      app,
      f.key,
      `/api/imports/${run.id}/dry-run-all`,
      post(),
    );
    const blockedBody = (await blocked.json()) as Json;
    expect(
      blocked.status === 200 ? blockedBody.counts.rejected : 1,
    ).toBeGreaterThan(0);

    const confirmed = await confirmAndMapRest(app, f, run.id, mapping);
    expect(confirmed.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      processed: 32,
      rejected: 0,
      created: 32,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );

    const outcome = await runImportRun(run.id);
    expect(outcome).toMatchObject({ status: "completed", chunks: 4 });
    expect(await itemCount()).toBe(32);
    expect(await linkCount()).toBe(32);
    const done = await runRow(run.id);
    expect(done.stats).toMatchObject({
      created: 32,
      skipped: 0,
      processed: 32,
    });

    // Provenance: every record keeps its Jira URL.
    const links = await db.select().from(schema.importRecordLinkTable);
    expect(
      links.every((l) =>
        l.sourceUrl?.startsWith(
          "https://acme-fixture.atlassian.net/browse/ACME-",
        ),
      ),
    ).toBe(true);

    // The loss report lists exactly what the adapter reported, per code and detail.
    const losses = await call(
      app,
      f.key,
      `/api/imports/${run.id}/losses`,
      undefined,
      200,
    );
    const reference = await readAllRecords(
      getImportAdapter("import.jira") as ImportSourceAdapter,
      config,
      null,
      "import.jira",
    );
    for (const [key, count] of lossTally(reference)) {
      const [code, detail] = key.split("|");
      const matching = (losses.summary as Json[]).filter(
        (row) => row.code === code && (row.detailCode ?? "") === detail,
      );
      expect(
        matching.reduce((sum, row) => sum + Number(row.count), 0),
        key,
      ).toBe(count);
    }
    const codes = new Set((losses.summary as Json[]).map((row) => row.code));
    for (const code of [
      "worklog_not_imported",
      "duplicate_row_collapsed",
      "person_email_unavailable",
      "rich_text_lossy",
      "security_level_not_imported",
    ])
      expect(codes.has(code), code).toBe(true);
    // Record v2: comments, links and history are written, no longer reported as not imported.
    for (const gone of [
      "comment_not_imported",
      "attachment_not_imported",
      "link_not_imported",
      "changelog_not_imported",
    ])
      expect(codes.has(gone), gone).toBe(false);
    expect(await db.select().from(schema.commentTable)).not.toHaveLength(0);
    expect(
      (losses.losses as Json[]).some((row) => row.sourceId === "ACME-4"),
    ).toBe(true);

    // The run status is the reconciled total.
    const status = await call(
      app,
      f.key,
      `/api/imports/${run.id}/engine`,
      undefined,
      200,
    );
    expect(status).toMatchObject({
      state: "completed",
      stats: { created: 32 },
    });
  });

  it("a rerun of the same export creates no duplicates and reuses the saved mapping", async () => {
    const f = await engineFixture();
    await seedStates(f);
    registerJiraAdapters({
      transport: recordedTransport().transport,
      sleep: noSleep,
      chunkSize: 10,
    });
    const { app } = createApp();
    const config = { export: jiraExport };
    const first = await startRun(app, f, "import.jira", config, "acme-rerun");
    await confirmAndMapRest(app, f, first.run.id, first.mapping);
    const dry1 = await dryRunAndExecuteBody(app, f.key, first.run.id);
    await call(
      app,
      f.key,
      `/api/imports/${first.run.id}/execute`,
      post(dry1.body),
      202,
    );
    await runImportRun(first.run.id);
    const itemsBefore = await itemCount();
    const linksBefore = (await db.select().from(schema.importRecordLinkTable))
      .map((l) => `${l.sourceId}:${l.targetId}`)
      .sort();
    expect(itemsBefore).toBe(32);

    const { run, mapping } = await startRun(
      app,
      f,
      "import.jira",
      config,
      "acme-rerun",
    );
    expect(mapping.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 32,
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
    expect(
      (await db.select().from(schema.importRecordLinkTable))
        .map((l) => `${l.sourceId}:${l.targetId}`)
        .sort(),
    ).toEqual(linksBefore);
    expect((await runRow(run.id)).stats).toMatchObject({
      created: 0,
      skipped: 32,
      processed: 32,
    });
  });

  it("only an instance administrator can create, discover or read an import from Jira", async () => {
    const f = await engineFixture();
    registerJiraAdapters({
      transport: recordedTransport().transport,
      sleep: noSleep,
    });
    const { app } = createApp();
    const { source, run } = await startRun(
      app,
      f,
      "import.jira",
      { export: jiraExport },
      "acme-denied",
    );
    // A workspace owner who is not an instance administrator.
    const member = await createWorkspaceMember({ role: "owner" });
    const key = await createPersonalApiKey(
      { userId: member.user.id },
      {
        name: "plain member",
        capabilities: ["work_item:read", "work_item:create"],
      },
    );
    const attempts: Array<[string, RequestInit | undefined]> = [
      [
        "/api/import-sources",
        post({
          workspaceId: member.workspace.id,
          pluginId: "import.jira",
          name: "nope",
          config: { export: jiraExport },
        }),
      ],
      [`/api/import-sources?workspaceId=${f.workspace.id}`, undefined],
      [
        `/api/import-sources/${source.id}/runs`,
        post({ projectId: f.project.id, sourceRef: "x" }),
      ],
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
    ];
    for (const [path, init] of attempts) {
      const response = await req(app, key.key, path, init);
      expect([401, 403, 404], path).toContain(response.status);
    }
    expect(await itemCount()).toBe(0);
  });
});

describe("jira REST mode end to end (recorded responses)", () => {
  const rest = {
    mode: "rest",
    baseUrl: "https://acme-fixture.atlassian.net",
    projectKey: "ACME",
  };

  it("runs from recorded pages, resumes from the stored cursor, and never stores or returns the token", async () => {
    const f = await engineFixture();
    await seedStates(f);
    const recorded = recordedTransport();
    registerJiraAdapters({ transport: recorded.transport, sleep: noSleep });
    const { app } = createApp();
    const { source, run, mapping } = await startRun(
      app,
      f,
      "import.jira",
      rest,
      "acme-rest",
      TEST_CREDENTIAL,
    );
    await confirmAndMapRest(app, f, run.id, mapping);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({ processed: 32, rejected: 0 });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );

    recorded.calls.length = 0;
    expect(await runImportRun(run.id, { stopAfterChunks: 1 })).toMatchObject({
      status: "stopped",
      chunks: 1,
    });
    const cursorAfter = (await runRow(run.id)).sourceCursor as Json;
    expect(cursorAfter).toEqual({ cursor: "tok-page-2", exhausted: false });
    expect(await itemCount()).toBe(12);
    expect(
      recorded.calls.map((c) => c.url.searchParams.get("nextPageToken")),
    ).toEqual([null]);

    recorded.calls.length = 0;
    expect(await runImportRun(run.id)).toMatchObject({
      status: "completed",
      chunks: 2,
    });
    // Resumed from the stored cursor, never from the start; reads only.
    expect(
      recorded.calls.map((c) => c.url.searchParams.get("nextPageToken")),
    ).toEqual(["tok-page-2", "tok-page-3"]);
    expect(recorded.calls.every((c) => c.authorized)).toBe(true);
    expect(await itemCount()).toBe(32);
    expect(await linkCount()).toBe(32);
    expect((await runRow(run.id)).stats).toMatchObject({
      created: 32,
      processed: 32,
    });

    // The credential never leaves the server: not in the connection list, not in the run row.
    const sources = await call(
      app,
      f.key,
      `/api/import-sources?workspaceId=${f.workspace.id}`,
      undefined,
      200,
    );
    expect(JSON.stringify(sources)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(await runRow(run.id))).not.toContain(TEST_TOKEN);
    const stored = (await db.select().from(importSourceConnectionTable)).find(
      (c) => c.id === source.id,
    );
    expect(stored?.readOnly).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(TEST_TOKEN);
  });

  it("a source outage pauses at the failed page and resumes from it", async () => {
    const f = await engineFixture();
    await seedStates(f);
    // Page 3 answers 500 once the run is executing, then recovers.
    const pages = {
      first: loadFixture("jira/rest-page-1.json"),
      "tok-page-2": loadFixture("jira/rest-page-2.json"),
      "tok-page-3": loadFixture("jira/rest-page-3.json"),
    };
    const base = recordedTransport({ pages });
    let failPage3 = false;
    registerJiraAdapters({
      sleep: noSleep,
      transport: async (request) => {
        if (
          failPage3 &&
          new URL(request.url).searchParams.get("nextPageToken") ===
            "tok-page-3"
        )
          return { status: 500, headers: {}, body: "{}" };
        return base.transport(request);
      },
    });
    const { app } = createApp();
    const { run, mapping } = await startRun(
      app,
      f,
      "import.jira",
      rest,
      "acme-outage",
      TEST_CREDENTIAL,
    );
    await confirmAndMapRest(app, f, run.id, mapping);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    failPage3 = true;
    const outage = await runImportRun(run.id);
    expect(outage.status).not.toBe("completed");
    expect(await itemCount()).toBe(24);
    expect((await runRow(run.id)).sourceCursor).toEqual({
      cursor: "tok-page-3",
      exhausted: false,
    });
    failPage3 = false;
    await call(app, f.key, `/api/imports/${run.id}/resume`, post(), 200);
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(32);
    expect(await linkCount()).toBe(32);
  });
});

describe("jsm export end to end", () => {
  it("imports service requests, keeps internal comments reported apart and lists SLA/approval/queue losses", async () => {
    const f = await engineFixture();
    await seedStates(f);
    registerJiraAdapters({
      transport: recordedTransport().transport,
      sleep: noSleep,
      chunkSize: 10,
    });
    const { app } = createApp();
    const config = { export: jsmExport };
    const { run, mapping } = await startRun(
      app,
      f,
      "import.jsm",
      config,
      "acme-jsm",
    );
    expect(mapping.discovery).toMatchObject({ totalRecords: 32 });
    const cancelled = (mapping.entries as Json[]).filter(
      (e) => e.domain === "state" && e.target?.group === "cancelled",
    );
    expect(cancelled.map((e) => e.value).sort()).toEqual([
      "Canceled / Cancelled",
      "Closed / Declined",
      "Closed / Duplicate",
      "Closed / Won't Do",
    ]);
    await confirmAndMapRest(app, f, run.id, mapping);
    const dry = await dryRunAndExecuteBody(app, f.key, run.id);
    expect(dry.report.counts).toMatchObject({
      processed: 32,
      rejected: 0,
      created: 32,
    });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });
    expect(await itemCount()).toBe(32);
    expect(await linkCount()).toBe(32);

    const reference = await readAllRecords(
      getImportAdapter("import.jsm") as ImportSourceAdapter,
      config,
      null,
      "import.jsm",
    );
    const losses = await call(
      app,
      f.key,
      `/api/imports/${run.id}/losses`,
      undefined,
      200,
    );
    const summary = losses.summary as Json[];
    const count = (code: string, detail?: string) =>
      summary
        .filter(
          (row) =>
            row.code === code &&
            (detail === undefined || row.detailCode === detail),
        )
        .reduce((sum, row) => sum + Number(row.count), 0);
    expect(count("queue_not_imported")).toBe(32);
    expect(count("sla_not_imported")).toBe(
      lossTally(reference).get("sla_not_imported|") ?? 0,
    );
    expect(count("sla_not_imported")).toBeGreaterThan(0);
    expect(count("approval_not_imported")).toBeGreaterThan(0);
    // Comments are written with their visibility; nothing is reported as not imported.
    expect(count("comment_not_imported")).toBe(0);
    const visibilities = new Set(
      (await db.select().from(schema.commentTable)).map((c) => c.visibility),
    );
    expect(visibilities.has("internal")).toBe(true);
  });
});
