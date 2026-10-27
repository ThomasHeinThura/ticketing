/**
 * P6 round-1 fixes (writer side): P6-R1-03 the parent depth cap, P6-R1-04 provenance and the
 * imported-origin markers readable through the native APIs, P6-R1-09 the plugin-scoped provenance
 * namespace and a reported duplicate claim.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  claimEntityProvenance,
  createImportWriterContext,
  markMissingImportSourcesStale,
  upsertWorkItemProvenance,
} from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { mockAuthenticatedSession } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/database";
import {
  commitChunk,
  createRun,
  getReport,
  record,
  writerFixture,
} from "./writer-fixture";

beforeEach(async () => resetTestDatabase());

async function targetOf(
  commit: { rows: Array<{ sourceId: string; targetId?: string }> },
  sourceId: string,
) {
  const id = commit.rows.find((row) => row.sourceId === sourceId)?.targetId;
  const [item] = await db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, id as string));
  if (!item) throw new Error(`no target for ${sourceId}`);
  return item;
}

async function depthOf(id: string) {
  let depth = 1;
  let current = id;
  for (;;) {
    const [row] = await db
      .select({ parentId: schema.workItemTable.parentId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, current));
    if (!row?.parentId) return depth;
    depth += 1;
    current = row.parentId;
  }
}

describe("P6-R1-03: imported parents obey the hierarchy depth cap", () => {
  it("sets a parent only up to depth 5 and reports the rest with source ids", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "depth-in-order");
    const ids = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
    const { commit } = await commitChunk(
      app,
      f,
      run.id,
      "c1",
      ids.map((id, index) =>
        record(
          f,
          id,
          index === 0
            ? {}
            : { parent: { sourceType: "issue", sourceId: ids[index - 1] } },
        ),
      ),
    );
    const items = await Promise.all(ids.map((id) => targetOf(commit, id)));
    // n2..n5 nest to depth 5; n6 would be level 6 and stays a root; n7 then nests under n6.
    expect(items.map((item) => item.parentId !== null)).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      true,
    ]);
    expect(
      Math.max(...(await Promise.all(items.map((i) => depthOf(i.id))))),
    ).toBe(5);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toMatchObject({
      parent_depth_exceeded: 1,
    });
    expect(
      report.chunks[0]?.losses?.find((l) => l.code === "parent_depth_exceeded"),
    ).toMatchObject({
      sourceType: "issue",
      sourceId: "n6",
      entity: "parent",
      entitySourceId: "issue:n5",
    });
  });

  it("holds the cap when children arrive before their parents (deferred links)", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "depth-reversed");
    const ids = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
    const { commit } = await commitChunk(
      app,
      f,
      run.id,
      "c1",
      [...ids].reverse().map((id, index, all) =>
        record(
          f,
          id,
          index === all.length - 1
            ? {}
            : {
                parent: {
                  sourceType: "issue",
                  sourceId: all[index + 1] as string,
                },
              },
        ),
      ),
    );
    const items = await Promise.all(ids.map((id) => targetOf(commit, id)));
    const depths = await Promise.all(items.map((item) => depthOf(item.id)));
    expect(Math.max(...depths)).toBeLessThanOrEqual(5);
    const report = await getReport(app, f, run.id);
    expect(
      Object.values(report.chunks[0]?.lossCounts ?? {}).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      report.chunks[0]?.lossCounts?.parent_depth_exceeded,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("P6-R1-04: provenance and imported origin are readable", () => {
  it("returns the item's import provenance and marks imported comments and history", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "prov-read");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "PR-1", {
        sourceUrl: "https://tracker.example.test/browse/PR-1",
        sourceCreatedAt: "2021-01-05T09:00:00.000Z",
        sourceUpdatedAt: "2021-02-05T09:00:00.000Z",
        comments: [
          {
            sourceId: "pr1-c1",
            authorEmail: "gone@example.test",
            authorName: "Gone",
            body: "Historic note",
            createdAt: "2021-02-03T04:05:06.000Z",
          },
        ],
        history: [
          {
            sourceId: "pr1-h1",
            at: "2021-03-04T05:06:07.000Z",
            field: "Severity",
            from: "3",
            to: "1",
          },
        ],
      }),
    ]);
    const item = await targetOf(commit, "PR-1");
    mockAuthenticatedSession(f.user);

    const detail = await app.request(`/api/work-items/${item.key}`);
    expect(detail.status, await detail.clone().text()).toBe(200);
    const body = (await detail.json()) as {
      importProvenance: Array<Record<string, unknown>>;
    };
    expect(body.importProvenance).toHaveLength(1);
    expect(body.importProvenance[0]).toMatchObject({
      system: "prov-read",
      pluginId: "import.mcp",
      sourceUrl: "https://tracker.example.test/browse/PR-1",
      stale: false,
      sourceCreatedAt: "2021-01-05T09:00:00.000Z",
      sourceUpdatedAt: "2021-02-05T09:00:00.000Z",
    });
    expect(typeof body.importProvenance[0]?.importedAt).toBe("string");
    // Provenance rows of comments never leak into the item's own list.
    expect(body.importProvenance).toHaveLength(1);

    const activity = await app.request(`/api/work-items/${item.key}/activity`);
    expect(activity.status, await activity.clone().text()).toBe(200);
    const stream = (
      (await activity.json()) as { data: Array<Record<string, unknown>> }
    ).data;
    const comment = stream.find((row) => row.kind === "comment");
    expect(comment).toMatchObject({ origin: "imported" });
    expect(typeof comment?.importedAt).toBe("string");
    const history = stream.find((row) => row.field === "Severity");
    expect(history).toMatchObject({ origin: "imported" });
    expect(typeof history?.importedAt).toBe("string");

    // A later complete run that no longer finds the record marks the link stale.
    const run2 = await createRun(app, f, "prov-read");
    await db.transaction((tx) =>
      markMissingImportSourcesStale(tx, {
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        sourceRef: "prov-read",
        currentRunId: run2.id,
      }),
    );
    mockAuthenticatedSession(f.user);
    const stale = await app.request(`/api/work-items/${item.key}`);
    const after = (await stale.json()) as {
      importProvenance: Array<{ stale: boolean }>;
    };
    expect(after.importProvenance[0]?.stale).toBe(true);
  });

  it("returns an empty provenance list for a native item and no origin on native rows", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const { default: createWorkItem } = await import(
      "../../../apps/api/src/work-item/controllers/create-work-item"
    );
    const native = await createWorkItem({
      workspaceId: f.workspace.id,
      projectId: f.project.id,
      typeId: f.type.id,
      title: "Native",
      actorId: f.user.id,
      actorType: "person",
    });
    mockAuthenticatedSession(f.user);
    const detail = await app.request(`/api/work-items/${native.key}`);
    expect(
      ((await detail.json()) as { importProvenance: unknown[] })
        .importProvenance,
    ).toEqual([]);
    const activity = await app.request(
      `/api/work-items/${native.key}/activity`,
    );
    const stream = (
      (await activity.json()) as { data: Array<Record<string, unknown>> }
    ).data;
    expect(stream.length).toBeGreaterThan(0);
    for (const row of stream) {
      expect(row.origin ?? null).toBeNull();
      expect(row.importedAt ?? null).toBeNull();
    }
  });
});

describe("P6-R1-09: provenance is scoped by plugin and duplicate claims are reported", () => {
  it("keeps two plugins that share a source reference apart, including stale marking", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "shared-ref");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "SH-1"),
    ]);
    const item = await targetOf(commit, "SH-1");
    const [own] = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(eq(schema.importProvenanceTable.workItemId, item.id));
    expect(own).toMatchObject({ pluginId: "import.mcp", system: "shared-ref" });

    // Another plugin imported the SAME source reference and external id: no collision.
    const other = await createRun(app, f, "other-ref");
    await db.insert(schema.importProvenanceTable).values({
      resourceType: "import",
      externalId: own?.externalId as string,
      workspaceId: f.workspace.id,
      workItemId: item.id,
      entityType: "work_item",
      entityId: item.id,
      system: "shared-ref",
      pluginId: "import.csv",
      projectId: f.project.id,
      organisationId: f.workspace.organisationId,
      origin: "imported",
      importRunId: other.id,
      lastSeenAt: new Date(),
    });
    const marked = await db.transaction((tx) =>
      markMissingImportSourcesStale(tx, {
        workspaceId: f.workspace.id,
        pluginId: "import.csv",
        sourceRef: "shared-ref",
        currentRunId: "some-later-run",
      }),
    );
    expect(marked.provenance).toBe(1);
    const rows = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(eq(schema.importProvenanceTable.workItemId, item.id));
    expect(rows.find((r) => r.pluginId === "import.mcp")?.staleAt).toBeNull();
    expect(
      rows.find((r) => r.pluginId === "import.csv")?.staleAt,
    ).not.toBeNull();
  });

  it("reports a source entity already claimed for another work item instead of skipping silently", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "dup-claim");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "D-1", {
        comments: [{ sourceId: "d1-c1", body: "first" }],
      }),
      record(f, "D-2"),
    ]);
    const first = await targetOf(commit, "D-1");
    const second = await targetOf(commit, "D-2");
    const result = await db.transaction(async (tx) => {
      const ctx = await createImportWriterContext(tx, {
        id: run.id,
        workspaceId: f.workspace.id,
        projectId: f.project.id,
        pluginId: "import.mcp",
        sourceRef: "dup-claim",
      });
      const claim = await claimEntityProvenance(ctx, {
        entityType: "comment",
        externalId: "issue:D-1#comment:d1-c1",
        entityId: "would-be-new-comment",
        workItemId: second.id,
      });
      const upsert = await upsertWorkItemProvenance(ctx, {
        workItemId: second.id,
        record: record(f, "D-1") as never,
        deferred: null,
      });
      return { claim, upsert, losses: ctx.losses };
    });
    expect(result.claim).toMatchObject({ claimed: false, conflict: true });
    expect(result.upsert).toBe(false);
    expect(result.losses).toEqual([
      expect.objectContaining({
        code: "provenance_duplicate",
        sourceId: "D-1",
        entity: "work_item",
      }),
    ]);
    // The rows were not taken over.
    const rows = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(
        and(
          eq(schema.importProvenanceTable.workspaceId, f.workspace.id),
          eq(schema.importProvenanceTable.system, "dup-claim"),
        ),
      );
    expect(
      rows.every(
        (r) => r.workItemId !== second.id || r.externalId === "issue:D-2",
      ),
    ).toBe(true);
    expect(
      rows.filter((r) => r.workItemId === first.id).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
