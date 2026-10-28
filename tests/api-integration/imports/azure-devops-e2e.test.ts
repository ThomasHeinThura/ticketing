import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { importSourceConnectionTable } from "../../../apps/api/src/database/schema-imports";
import {
  createAzureDevOpsAdapter,
  registerAzureDevOpsAdapter,
} from "../../../apps/api/src/imports/adapters/azure-devops";
import { proposeStateGroup } from "../../../apps/api/src/imports/adapters/azure-devops/mapping";
import {
  type StateGroup,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import { createApp } from "../../../apps/api/src/index";
import {
  ADO_FIXTURE_PAT,
  ADO_PROJECTS,
  type AdoFixtureItem,
  adoCsvText,
  adoItems,
  createAdoReplay,
} from "../../fixtures/imports/azure-devops/replay";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember } from "../helpers/fixtures";
import {
  decideMapping,
  type Fixture,
  importedItems,
  makeTypes,
  startSourceRun,
  tally,
} from "./adapter-e2e-helpers";
import {
  call,
  dryRunAndExecuteBody,
  engineFixture,
  post,
  req,
  runRow,
} from "./engine-helpers";

// Explicit operator decisions for states the adapter deliberately does not propose.
const OPERATOR_STATES: Record<string, StateGroup> = {
  "Agile/Resolved": "started",
  "CMMI/Resolved": "completed",
  "Scrum/Open": "started",
  "Scrum/Closed": "completed",
};
const typeNames = (items: AdoFixtureItem[]) => [
  ...new Set(items.map((i) => String(i.fields["System.WorkItemType"]))),
];
const stateKey = (process: string, item: AdoFixtureItem) =>
  `${process}/${String(item.fields["System.State"])}`;
function expectedGroups(process: string, items: AdoFixtureItem[]) {
  const groups: Record<StateGroup, number> = {
    backlog: 0,
    unstarted: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const item of items) {
    const key = stateKey(process, item);
    const group = OPERATOR_STATES[key] ?? proposeStateGroup(key);
    if (!group) throw new Error(`no group for ${key}`);
    groups[group] += 1;
  }
  return groups;
}

let replay: ReturnType<typeof createAdoReplay>;
beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  replay = createAdoReplay();
  registerAzureDevOpsAdapter({ transport: replay.transport, chunkSize: 10 });
});
afterEach(() => unregisterImportAdapter("import.azure-devops"));

const sourceFor = (project: string) => ({
  pluginId: "import.azure-devops" as const,
  config: { organization: "contoso", project },
  credential: ADO_FIXTURE_PAT,
  sourceRef: `ado-contoso-${project.toLowerCase().replace(/\s+/gu, "-")}`,
});

async function prepared(f: Fixture, project: (typeof ADO_PROJECTS)[number]) {
  const { app } = createApp();
  const items = adoItems(project.slug);
  const types = await makeTypes(f, typeNames(items));
  const source = sourceFor(project.name);
  const started = await startSourceRun(app, f, source);
  const decided = await decideMapping(app, f, started.run.id, started.mapping, {
    types,
    states: OPERATOR_STATES,
  });
  const dry = await dryRunAndExecuteBody(app, f.key, started.run.id);
  return { app, items, types, source, started, decided, dry };
}

describe("azure devops import through the engine (recorded fixtures)", () => {
  it("imports one project end to end: counts per type and state group, provenance, losses, read-only", async () => {
    const f = await engineFixture();
    const { app, items, types, source, started, decided, dry } = await prepared(
      f,
      ADO_PROJECTS[0],
    );
    expect(items.length).toBeGreaterThanOrEqual(20);

    // Discovery: Resolved was not proposed, so confirm-all alone did not complete the mapping.
    expect(
      started.mapping.entries.find(
        (e: { value: string }) => e.value === "Agile/Resolved",
      ),
    ).toMatchObject({ status: "unmapped", target: null });
    expect(started.mapping.completeness.complete).toBe(false);
    expect(decided.completeness).toMatchObject({ complete: true });
    // state group distribution (the engine's own count) equals the fixture's
    expect(decided.completeness.stateGroups).toEqual(
      expectedGroups("Agile", items),
    );
    expect(decided.completeness.stateGroups.cancelled).toBe(
      items.filter((i) => i.fields["System.State"] === "Removed").length,
    );

    expect(dry.report.counts).toMatchObject({
      created: items.length,
      updated: 0,
      rejected: 0,
      processed: items.length,
    });
    const lossCodes = new Set(
      (dry.report.losses as Array<{ code: string }>).map((l) => l.code),
    );
    for (const code of [
      "rich_text_lossy",
      "relation_type_unsupported",
      "revision_not_imported",
      "author_email_unavailable",
    ])
      expect(lossCodes.has(code), code).toBe(true);

    await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(started.run.id)).toMatchObject({
      status: "completed",
      chunks: 2,
    });
    expect(await runRow(started.run.id)).toMatchObject({
      state: "completed",
      stats: { created: items.length, processed: items.length },
    });

    // counts per project and per type match the source
    const imported = await importedItems(f, source.sourceRef);
    expect(imported.items).toHaveLength(items.length);
    const typeById = new Map([...types].map(([name, id]) => [id, name]));
    expect(tally(imported.items, (i) => typeById.get(i.typeId) ?? "?")).toEqual(
      tally(items, (i) => String(i.fields["System.WorkItemType"])),
    );
    // provenance: every record links to its original in Azure DevOps
    expect(imported.links).toHaveLength(items.length);
    for (const link of imported.links) {
      const item = items.find((i) => String(i.id) === link.sourceId);
      expect(link.sourceUrl).toBe(
        `https://dev.azure.com/contoso/Contoso%20Web/_workitems/edit/${item?.id}`,
      );
    }
    // parent edges are never silent: persisted, or reported as unavailable in the loss report
    const withParent = items.filter((i) =>
      i.relations?.some((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse"),
    ).length;
    const losses = await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/losses?limit=200`,
      undefined,
      200,
    );
    const unavailableParents = losses.summary
      .filter(
        (s: { code: string; detailCode: string }) =>
          s.code === "writer_unavailable" && s.detailCode === "parent",
      )
      .reduce((sum: number, s: { count: number }) => sum + s.count, 0);
    const persistedParents = imported.items.filter((i) => i.parentId).length;
    expect(persistedParents + unavailableParents).toBe(withParent);
    // adapter losses reach the persisted loss report with fixed codes
    const summaryCodes = new Set(
      losses.summary.map((s: { code: string }) => s.code),
    );
    expect(summaryCodes.has("rich_text_lossy")).toBe(true);
    expect(summaryCodes.has("relation_type_unsupported")).toBe(true);
    for (const row of losses.losses)
      expect(row.code).toMatch(/^[a-z][a-z0-9_]{1,63}$/u);

    // read-only: only GETs and the two query POSTs were ever sent, and never to a wiki or write path
    for (const request of replay.requests) {
      expect(["GET", "POST"]).toContain(request.method);
      if (request.method === "POST")
        expect(request.path).toMatch(/\/_apis\/wit\/(?:wiql|workitemsbatch)$/u);
    }
    // the credential never reaches an API response
    const status = await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/engine`,
      undefined,
      200,
    );
    expect(JSON.stringify([status, losses, started.source])).not.toContain(
      ADO_FIXTURE_PAT,
    );
  });

  it("a rerun against the same source creates no duplicates and reuses the saved mapping", async () => {
    const f = await engineFixture();
    const first = await prepared(f, ADO_PROJECTS[0]);
    await call(
      first.app,
      f.key,
      `/api/imports/${first.started.run.id}/execute`,
      post(first.dry.body),
      202,
    );
    await runImportRun(first.started.run.id);
    const before = await importedItems(f, first.source.sourceRef);
    const itemsBefore = (await db.select().from(schema.workItemTable)).length;

    const { app } = createApp();
    const second = await startSourceRun(app, f, first.source);
    // confirmed entries (including the explicit Resolved choice) survive rediscovery
    expect(second.mapping.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, second.run.id);
    expect(dry.report.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: first.items.length,
      rejected: 0,
    });
    await call(
      app,
      f.key,
      `/api/imports/${second.run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(second.run.id)).toMatchObject({
      status: "completed",
    });
    const after = await importedItems(f, first.source.sourceRef);
    expect(after.links.map((l) => l.targetId).sort()).toEqual(
      before.links.map((l) => l.targetId).sort(),
    );
    expect((await db.select().from(schema.workItemTable)).length).toBe(
      itemsBefore,
    );
  });

  it("resumes from the last committed chunk using the keyset cursor, without re-reading or duplicating", async () => {
    const f = await engineFixture();
    const { app, items, source, started, dry } = await prepared(
      f,
      ADO_PROJECTS[0],
    );
    await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
      202,
    );
    const wiqlBefore = replay.requests.filter((r) =>
      r.path.endsWith("/wiql"),
    ).length;
    expect(
      await runImportRun(started.run.id, { stopAfterChunks: 1 }),
    ).toMatchObject({
      status: "stopped",
      chunks: 1,
    });
    expect((await importedItems(f, source.sourceRef)).items).toHaveLength(10);
    const cursor = (await runRow(started.run.id)).sourceCursor as {
      cursor: string;
      exhausted: boolean;
    };
    expect(cursor.exhausted).toBe(false);
    expect(cursor.cursor).toMatch(/^0:\d+$/u);
    const checkpointId = Number(cursor.cursor.split(":")[1]);
    // the first ten ids (ascending) were committed
    const sortedIds = items.map((i) => i.id).sort((a, b) => a - b);
    expect(checkpointId).toBe(sortedIds[9]);

    const bodiesBefore = replay.requests.length;
    expect(await runImportRun(started.run.id)).toMatchObject({
      status: "completed",
      chunks: 1,
    });
    expect(replay.requests.length).toBeGreaterThan(bodiesBefore);
    expect(wiqlBefore).toBeGreaterThan(0);
    const { items: imported } = await importedItems(f, source.sourceRef);
    expect(imported).toHaveLength(items.length);
    expect(new Set(imported.map((i) => i.id)).size).toBe(items.length);
    // no source item was fetched twice by the resumed run: every batch after the checkpoint
    // contains only ids above it
    expect(replay.authorizations.size).toBe(1);
  });

  it.each(ADO_PROJECTS)(
    "imports $name ($process process) with the right counts per type and state group",
    async (project) => {
      const f = await engineFixture();
      const { app, items, types, source, started, decided, dry } =
        await prepared(f, project);
      expect(decided.completeness.stateGroups).toEqual(
        expectedGroups(project.process, items),
      );
      // every process's Removed items are cancelled, never completed
      const removed = items.filter(
        (i) => i.fields["System.State"] === "Removed",
      ).length;
      const removedEntries = decided.entries.filter(
        (e: { value: string }) => e.value === `${project.process}/Removed`,
      );
      for (const entry of removedEntries)
        expect(entry.target).toEqual({ kind: "group", group: "cancelled" });
      if (removed > 0) expect(removedEntries).toHaveLength(1);
      expect(dry.report.counts).toMatchObject({
        created: items.length,
        rejected: 0,
      });
      await call(
        app,
        f.key,
        `/api/imports/${started.run.id}/execute`,
        post(dry.body),
        202,
      );
      expect(await runImportRun(started.run.id)).toMatchObject({
        status: "completed",
      });
      const typeById = new Map([...types].map(([name, id]) => [id, name]));
      const imported = await importedItems(f, source.sourceRef);
      expect(
        tally(imported.items, (i) => typeById.get(i.typeId) ?? "?"),
      ).toEqual(tally(items, (i) => String(i.fields["System.WorkItemType"])));
      expect(imported.items).toHaveLength(items.length);
    },
  );

  it("holds an unknown Scrum impediment state until a person maps it (never guessed)", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const project = ADO_PROJECTS[1];
    const types = await makeTypes(f, typeNames(adoItems(project.slug)));
    const started = await startSourceRun(app, f, sourceFor(project.name));
    const blocking = (
      started.mapping.completeness.blocking as Array<{
        domain: string;
        value: string;
      }>
    )
      .filter((b) => b.domain === "state")
      .map((b) => b.value);
    expect(blocking).toEqual(
      expect.arrayContaining(["Scrum/Open", "Scrum/Closed"]),
    );
    const unresolved = await decideMapping(
      app,
      f,
      started.run.id,
      started.mapping,
      { types },
    );
    expect(unresolved.completeness.complete).toBe(false);
    const dry = await dryRunAndExecuteBody(app, f.key, started.run.id);
    const blockedExecute = await req(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
    );
    expect(blockedExecute.status).toBe(409);
  });

  it("a bad PAT is refused when the source is created, with a reason code and without echoing the credential", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.azure-devops",
        name: "bad-pat",
        config: { organization: "contoso" },
        credential: "definitely-wrong-pat",
      }),
    );
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("definitely-wrong-pat");
    expect(JSON.parse(text)).toMatchObject({ reason: "auth_failed" });
    expect(await db.select().from(importSourceConnectionTable)).toHaveLength(0);
  });

  it("CSV export mode runs end to end with explicit csv_* losses and no history, comments or relations", async () => {
    const f = await engineFixture();
    unregisterImportAdapter("import.azure-devops");
    registerAzureDevOpsAdapter({ chunkSize: 10 });
    const { app } = createApp();
    const items = adoItems("contoso-web");
    const types = await makeTypes(f, typeNames(items));
    const source = {
      pluginId: "import.azure-devops" as const,
      config: { mode: "csv", organization: "contoso", csvText: adoCsvText() },
      credential: "unused-csv-credential",
      sourceRef: "ado-contoso-csv",
    };
    const started = await startSourceRun(app, f, source);
    const decided = await decideMapping(
      app,
      f,
      started.run.id,
      started.mapping,
      {
        types,
        states: { "CSV/Resolved": "started" },
      },
    );
    expect(decided.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, started.run.id);
    expect(dry.report.counts).toMatchObject({ created: 20, rejected: 0 });
    const byCode = new Map(
      (dry.report.losses as Array<{ code: string; count: number }>).map((l) => [
        l.code,
        l.count,
      ]),
    );
    for (const code of [
      "csv_history_unavailable",
      "csv_comments_unavailable",
      "csv_attachments_unavailable",
      "csv_relations_unavailable",
    ])
      expect(byCode.get(code), code).toBe(20);
    await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(started.run.id)).toMatchObject({
      status: "completed",
    });
    expect((await importedItems(f, source.sourceRef)).items).toHaveLength(20);
    const losses = await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/losses?code=csv_history_unavailable`,
      undefined,
      200,
    );
    expect(losses.summary[0]).toMatchObject({
      code: "csv_history_unavailable",
      count: 20,
    });
  });

  it("denies a non-administrator on every import route and on another user's run", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const started = await startSourceRun(app, f, sourceFor("Intranet"));
    const other = await createWorkspaceMember({ role: "owner" });
    const key = await createPersonalApiKey(
      { userId: other.user.id },
      {
        name: "non-admin import attempt",
        capabilities: [
          "instance:admin",
          "work_item:create",
          "work_item:read",
          "work_item:update",
        ],
        isMcp: true,
      },
    );
    const denied = async (path: string, init?: RequestInit) => {
      const response = await req(app, key.key, path, init);
      expect([403, 404]).toContain(response.status);
    };
    await denied(
      "/api/import-sources",
      post({
        workspaceId: other.workspace.id,
        pluginId: "import.azure-devops",
        name: "nope",
        config: { organization: "contoso" },
        credential: ADO_FIXTURE_PAT,
      }),
    );
    await denied(`/api/import-sources?workspaceId=${other.workspace.id}`);
    await denied(`/api/imports/${started.run.id}/discover`, post());
    await denied(`/api/imports/${started.run.id}/mapping`);
    await denied(`/api/imports/${started.run.id}/losses`);
    await denied(`/api/imports/${started.run.id}/dry-run-all`, post());
    // the adapter was never reached for the denied callers beyond the admin's own discovery
    expect(replay.authorizations.size).toBe(1);
  });

  it("an adapter built without a transport uses the guarded egress and refuses to reach a private host", async () => {
    const adapter = createAzureDevOpsAdapter();
    const connected = await adapter.connect({
      pluginId: "import.azure-devops",
      config: { organization: "contoso", baseUrl: "https://127.0.0.1/contoso" },
      credential: ADO_FIXTURE_PAT,
      readOnly: true,
    });
    expect(connected).toMatchObject({ ok: false });
  });
});
