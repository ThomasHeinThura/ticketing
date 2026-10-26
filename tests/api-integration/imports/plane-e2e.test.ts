import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { registerPlaneAdapter } from "../../../apps/api/src/imports/adapters/plane";
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
  createPlaneReplay,
  PLANE_FIXTURE_KEY,
  PLANE_PROJECTS,
  planeIssues,
  planeProjects,
  planeStates,
  planeTypes,
} from "../../fixtures/imports/plane/replay";
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

type Row = Record<string, unknown>;
const TRIAGE_DECISION: Record<string, StateGroup> = {
  "ENG/Intake (triage)": "backlog",
};
const PRIORITY = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
  none: "medium",
} as const;

function scopeIssues(identifier?: string) {
  const rows: Array<{ issue: Row; project: string; group: string }> = [];
  for (const project of PLANE_PROJECTS) {
    if (identifier && project.identifier !== identifier) continue;
    const states = new Map(
      planeStates(project.identifier).map((s) => [
        s.id as string,
        s.group as string,
      ]),
    );
    for (const issue of planeIssues(project.identifier))
      rows.push({
        issue,
        project: project.identifier,
        group: states.get(issue.state as string) as string,
      });
  }
  return rows;
}
function typeNameOf(issue: Row, identifier: string): string {
  return String(
    planeTypes(identifier).find((t) => t.id === issue.type)?.name ?? "Issue",
  );
}

let replay: ReturnType<typeof createPlaneReplay>;
beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  replay = createPlaneReplay();
  registerPlaneAdapter({ transport: replay.transport, chunkSize: 10 });
});
afterEach(() => unregisterImportAdapter("import.plane"));

const source = (project?: string) => ({
  pluginId: "import.plane" as const,
  config: { workspace: "acme", ...(project ? { project } : {}) },
  credential: PLANE_FIXTURE_KEY,
  sourceRef: `plane-acme${project ? `-${project.toLowerCase()}` : ""}`,
});

async function prepared(f: Fixture, project?: string) {
  const { app } = createApp();
  const rows = scopeIssues(project);
  const typeNames = [
    ...new Set(rows.map((r) => typeNameOf(r.issue, r.project))),
  ];
  const types = await makeTypes(f, typeNames);
  const src = source(project);
  const started = await startSourceRun(app, f, src);
  const decided = await decideMapping(app, f, started.run.id, started.mapping, {
    types,
    states: TRIAGE_DECISION,
  });
  const dry = await dryRunAndExecuteBody(app, f.key, started.run.id);
  return { app, rows, types, src, started, decided, dry };
}

describe("plane import through the engine (recorded fixtures)", () => {
  it("imports the workspace end to end: per project, type, state group and priority, provenance, read-only", async () => {
    const f = await engineFixture();
    const { app, rows, types, src, started, decided, dry } = await prepared(f);
    expect(rows.length).toBeGreaterThanOrEqual(30);

    // Plane's groups are proposed exactly; the triage group is outside our five and was not guessed
    expect(
      started.mapping.entries.find(
        (e: { value: string }) => e.value === "ENG/Intake (triage)",
      ),
    ).toMatchObject({ status: "unmapped", target: null });
    expect(started.mapping.completeness.complete).toBe(false);
    expect(decided.completeness.complete).toBe(true);
    const expectedGroups = tally(rows, (r) =>
      r.group === "triage" ? "backlog" : r.group,
    );
    expect(decided.completeness.stateGroups).toEqual({
      backlog: 0,
      unstarted: 0,
      started: 0,
      completed: 0,
      cancelled: 0,
      ...expectedGroups,
    });
    // a cancelled source state is cancelled in the target
    expect(decided.completeness.stateGroups.cancelled).toBe(
      rows.filter((r) => r.group === "cancelled").length,
    );
    expect(decided.completeness.stateGroups.cancelled).toBeGreaterThan(0);

    expect(dry.report.counts).toMatchObject({
      created: rows.length,
      rejected: 0,
      processed: rows.length,
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
    expect(await runRow(started.run.id)).toMatchObject({
      state: "completed",
      stats: { created: rows.length },
    });

    const imported = await importedItems(f, src.sourceRef);
    expect(imported.items).toHaveLength(rows.length);
    // issue counts per project (provenance carries the project id) and per type
    const projectOfUrl = (url: string | null) =>
      planeProjects().find((p) => url?.includes(`/projects/${p.id}/`))
        ?.identifier as string;
    expect(tally(imported.links, (l) => projectOfUrl(l.sourceUrl))).toEqual(
      tally(rows, (r) => r.project),
    );
    const typeById = new Map([...types].map(([name, id]) => [id, name]));
    expect(tally(imported.items, (i) => typeById.get(i.typeId) ?? "?")).toEqual(
      tally(rows, (r) => typeNameOf(r.issue, r.project)),
    );
    // priority none -> Medium, others one to one
    expect(tally(imported.items, (i) => String(i.priority))).toEqual(
      tally(
        rows,
        (r) => PRIORITY[String(r.issue.priority) as keyof typeof PRIORITY],
      ),
    );
    // provenance links open the original in Plane
    for (const link of imported.links) {
      const row = rows.find((r) => r.issue.id === link.sourceId);
      const pid = planeProjects().find(
        (p) => p.identifier === row?.project,
      )?.id;
      expect(link.sourceUrl).toBe(
        `https://app.plane.so/acme/projects/${pid}/issues/${link.sourceId}`,
      );
    }
    // sub-issue edges are never silent: persisted, or reported as unavailable
    const withParent = rows.filter((r) => r.issue.parent).length;
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
    expect(
      imported.items.filter((i) => i.parentId).length + unavailableParents,
    ).toBe(withParent);
    const codes = new Set(losses.summary.map((s: { code: string }) => s.code));
    for (const code of [
      "rich_text_lossy",
      "revision_not_imported",
      "assignee_extra_dropped",
    ])
      expect(codes.has(code), code).toBe(true);

    // read-only: GET only, key never in a response
    expect(new Set(replay.requests.map((r) => r.method))).toEqual(
      new Set(["GET"]),
    );
    const status = await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/engine`,
      undefined,
      200,
    );
    expect(JSON.stringify([status, losses, started.source])).not.toContain(
      PLANE_FIXTURE_KEY,
    );
  });

  it("a rerun against the same source creates no duplicates and reuses the saved mapping", async () => {
    const f = await engineFixture();
    const first = await prepared(f, "OPS");
    await call(
      first.app,
      f.key,
      `/api/imports/${first.started.run.id}/execute`,
      post(first.dry.body),
      202,
    );
    await runImportRun(first.started.run.id);
    const before = await importedItems(f, first.src.sourceRef);
    const itemsBefore = (await db.select().from(schema.workItemTable)).length;
    expect(before.items).toHaveLength(first.rows.length);

    const { app } = createApp();
    const second = await startSourceRun(app, f, first.src);
    expect(second.mapping.completeness.complete).toBe(true);
    const dry = await dryRunAndExecuteBody(app, f.key, second.run.id);
    expect(dry.report.counts).toMatchObject({
      created: 0,
      updated: 0,
      skipped: first.rows.length,
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
    expect((await db.select().from(schema.workItemTable)).length).toBe(
      itemsBefore,
    );
    expect(
      (await importedItems(f, first.src.sourceRef)).links
        .map((l) => l.targetId)
        .sort(),
    ).toEqual(before.links.map((l) => l.targetId).sort());
  });

  it("resumes from the last committed chunk using the persisted Plane cursor", async () => {
    const f = await engineFixture();
    const { app, rows, src, started, dry } = await prepared(f, "ENG");
    expect(rows).toHaveLength(18);
    await call(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(
      await runImportRun(started.run.id, { stopAfterChunks: 1 }),
    ).toMatchObject({ status: "stopped", chunks: 1 });
    expect((await importedItems(f, src.sourceRef)).items).toHaveLength(10);
    const cursor = (await runRow(started.run.id)).sourceCursor as {
      cursor: string;
      exhausted: boolean;
    };
    expect(cursor.exhausted).toBe(false);
    expect(cursor.cursor).toMatch(/^0\|\d+:\d+:\d+$/u);
    expect(await runImportRun(started.run.id)).toMatchObject({
      status: "completed",
      chunks: 1,
    });
    const { items } = await importedItems(f, src.sourceRef);
    expect(items).toHaveLength(18);
    expect(new Set(items.map((i) => i.id)).size).toBe(18);
  });

  it("holds the triage state until a person maps it (never guessed)", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const rows = scopeIssues("ENG");
    const types = await makeTypes(f, [
      ...new Set(rows.map((r) => typeNameOf(r.issue, r.project))),
    ]);
    const started = await startSourceRun(app, f, source("ENG"));
    const confirmed = await decideMapping(
      app,
      f,
      started.run.id,
      started.mapping,
      { types },
    );
    expect(confirmed.completeness).toMatchObject({ complete: false });
    const dry = await dryRunAndExecuteBody(app, f.key, started.run.id);
    expect(dry.report.complete).toBe(false);
    const blocked = await req(
      app,
      f.key,
      `/api/imports/${started.run.id}/execute`,
      post(dry.body),
    );
    expect(blocked.status).toBe(409);
  });

  it("a bad API key is refused when the source is created, with a reason code and without echoing the credential", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(
      app,
      f.key,
      "/api/import-sources",
      post({
        workspaceId: f.workspace.id,
        pluginId: "import.plane",
        name: "bad-key",
        config: { workspace: "acme" },
        credential: "definitely-wrong-key",
      }),
    );
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("definitely-wrong-key");
    expect(JSON.parse(text)).toMatchObject({ reason: "auth_failed" });
  });

  it("denies a non-administrator on every import route and on another user's run", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const started = await startSourceRun(app, f, source("MKT"));
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
        pluginId: "import.plane",
        name: "nope",
        config: { workspace: "acme" },
        credential: PLANE_FIXTURE_KEY,
      }),
    );
    await denied(`/api/import-sources?workspaceId=${other.workspace.id}`);
    await denied(`/api/imports/${started.run.id}/discover`, post());
    await denied(`/api/imports/${started.run.id}/mapping`);
    await denied(`/api/imports/${started.run.id}/losses`);
    await denied(`/api/imports/${started.run.id}/dry-run-all`, post());
  });
});
