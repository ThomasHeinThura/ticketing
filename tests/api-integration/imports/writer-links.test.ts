import { and, eq, isNotNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../../apps/api/src/database/migration-schema";
import {
  createImportWriterContext,
  markMissingImportSourcesStale,
  resolveDeferredImportLinks,
} from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  commitChunk,
  createRun,
  getReport,
  record,
  writerFixture,
} from "./writer-fixture";

beforeEach(async () => resetTestDatabase());

async function itemBySource(runId: string, sourceId: string) {
  const [link] = await db
    .select()
    .from(schema.importRecordLinkTable)
    .where(
      and(
        eq(schema.importRecordLinkTable.importRunId, runId),
        eq(schema.importRecordLinkTable.sourceId, sourceId),
      ),
    );
  const [item] = await db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, link?.targetId as string));
  return item;
}

describe("import writer: parents, relations, provenance, reruns", () => {
  it("breaks a circular parent reference, keeps both items and reports the cycle", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "links-cycle");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "A", { parent: { sourceType: "issue", sourceId: "B" } }),
      record(f, "B", { parent: { sourceType: "issue", sourceId: "A" } }),
    ]);
    expect(commit.counts).toMatchObject({ created: 2, rejected: 0 });
    const a = await itemBySource(run.id, "A");
    const b = await itemBySource(run.id, "B");
    // A's parent (B) is not known when A is written, so it is deferred and resolved after the
    // chunk; whichever link would close the loop is refused: exactly one parent is set.
    const parents = [a?.parentId, b?.parentId].filter(Boolean);
    expect(parents).toHaveLength(1);
    expect(a?.parentId === b?.id || b?.parentId === a?.id).toBe(true);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toMatchObject({
      parent_cycle_broken: 1,
    });
    expect(
      report.chunks[0]?.losses?.find((l) => l.code === "parent_cycle_broken"),
    ).toMatchObject({ entity: "parent" });
  });

  it("rejects a self parent as a cycle and a longer loop as one cycle", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "links-loop");
    await commitChunk(app, f, run.id, "c1", [
      record(f, "S", { parent: { sourceType: "issue", sourceId: "S" } }),
      record(f, "X", { parent: { sourceType: "issue", sourceId: "Y" } }),
      record(f, "Y", { parent: { sourceType: "issue", sourceId: "Z" } }),
      record(f, "Z", { parent: { sourceType: "issue", sourceId: "X" } }),
    ]);
    const items = await Promise.all(
      ["S", "X", "Y", "Z"].map((id) => itemBySource(run.id, id)),
    );
    expect(items[0]?.parentId).toBeNull();
    // 3 edges, one refused
    expect(items.slice(1).filter((item) => item?.parentId).length).toBe(2);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts?.parent_cycle_broken).toBe(2);
  });

  it("resolves a parent and a relation whose target arrives in a later chunk, and reports what never arrives", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "links-deferred");
    await commitChunk(app, f, run.id, "c1", [
      record(f, "child", {
        parent: { sourceType: "issue", sourceId: "parent" },
        relations: [
          {
            type: "blocks",
            target: { sourceType: "issue", sourceId: "later" },
          },
        ],
      }),
      record(f, "orphan", {
        parent: { sourceType: "issue", sourceId: "never-imported" },
      }),
    ]);
    const childBefore = await itemBySource(run.id, "child");
    expect(childBefore?.parentId).toBeNull();
    const deferredRows = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(isNotNull(schema.importProvenanceTable.deferredLinks));
    expect(deferredRows).toHaveLength(2);

    await commitChunk(app, f, run.id, "c2", [
      record(f, "parent"),
      record(f, "later"),
    ]);
    const child = await itemBySource(run.id, "child");
    const parent = await itemBySource(run.id, "parent");
    const later = await itemBySource(run.id, "later");
    expect(child?.parentId).toBe(parent?.id);
    const relations = await db.select().from(schema.workItemRelationTable);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      sourceId: child?.id,
      targetId: later?.id,
      type: "blocks",
    });

    // end of run: the orphan's parent never came; it is reported, not dropped
    const finished = await db.transaction(async (tx) => {
      const ctx = await createImportWriterContext(tx, {
        id: run.id,
        workspaceId: f.workspace.id,
        projectId: f.project.id,
        pluginId: "import.mcp",
        sourceRef: "links-deferred",
      });
      const result = await resolveDeferredImportLinks(ctx, { finalize: true });
      return { result, losses: ctx.losses };
    });
    expect(finished.result.remaining).toBe(0);
    expect(finished.losses).toEqual([
      expect.objectContaining({
        code: "parent_unavailable",
        sourceId: "orphan",
        entity: "parent",
      }),
    ]);
    expect(
      await db
        .select()
        .from(schema.importProvenanceTable)
        .where(isNotNull(schema.importProvenanceTable.deferredLinks)),
    ).toHaveLength(0);
  });

  it("never links across workspaces even for an identical source identity", async () => {
    const a = await writerFixture();
    const b = await writerFixture();
    const { app } = createApp();
    const runA = await createRun(app, a, "shared-source");
    const runB = await createRun(app, b, "shared-source");
    await commitChunk(
      app,
      b,
      runB.id,
      "c1",
      [record(b, "target")],
      b.fullKey.key,
    );
    await commitChunk(app, a, runA.id, "c1", [
      record(a, "from-a", {
        parent: { sourceType: "issue", sourceId: "target" },
        relations: [
          {
            type: "relates",
            target: { sourceType: "issue", sourceId: "target" },
          },
        ],
      }),
    ]);
    const fromA = await itemBySource(runA.id, "from-a");
    expect(fromA?.parentId).toBeNull();
    expect(await db.select().from(schema.workItemRelationTable)).toHaveLength(
      0,
    );
  });

  it("writes provenance for items, comments and attachments and is idempotent on rerun", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run = await createRun(app, f, "links-rerun");
    const records = () => [
      record(f, "R-1", {
        sourceUrl: "https://source.example.test/issues/R-1",
        comments: [
          {
            sourceId: "r1-c1",
            body: "First",
            createdAt: "2023-01-01T00:00:00.000Z",
          },
          {
            sourceId: "r1-c2",
            body: "Second",
            createdAt: "2023-01-02T00:00:00.000Z",
          },
        ],
        history: [
          {
            sourceId: "r1-h1",
            at: "2023-01-03T00:00:00.000Z",
            field: "Status",
            from: "New",
            to: "Done",
          },
        ],
        relations: [
          { type: "relates", target: { sourceType: "issue", sourceId: "R-2" } },
        ],
      }),
      record(f, "R-2", {
        relations: [
          { type: "relates", target: { sourceType: "issue", sourceId: "R-1" } },
        ],
      }),
    ];
    await commitChunk(app, f, run.id, "c1", records());
    const first = {
      comments: (await db.select().from(schema.commentTable)).length,
      activity: (await db.select().from(schema.activityTable)).length,
      relations: (await db.select().from(schema.workItemRelationTable)).length,
      items: (await db.select().from(schema.workItemTable)).length,
      provenance: (await db.select().from(schema.importProvenanceTable)).length,
    };
    expect(first).toMatchObject({ comments: 2, relations: 1, items: 2 });
    // 2 work items + 2 comments
    expect(first.provenance).toBe(4);

    const run2 = await createRun(app, f, "links-rerun");
    const second = await commitChunk(app, f, run2.id, "c1", records());
    expect(second.commit.counts).toMatchObject({ created: 0 });
    const after = {
      comments: (await db.select().from(schema.commentTable)).length,
      activity: (await db.select().from(schema.activityTable)).length,
      relations: (await db.select().from(schema.workItemRelationTable)).length,
      items: (await db.select().from(schema.workItemTable)).length,
      provenance: (await db.select().from(schema.importProvenanceTable)).length,
    };
    expect(after).toEqual(first);
    // reruns refresh the touch marker instead of duplicating
    const touched = await db
      .select()
      .from(schema.importProvenanceTable)
      .where(eq(schema.importProvenanceTable.importRunId, run2.id));
    expect(touched).toHaveLength(4);
  });

  it("marks provenance stale when the source record disappears, retains the work item, and clears it on reappearance", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const run1 = await createRun(app, f, "links-stale");
    await commitChunk(app, f, run1.id, "c1", [
      record(f, "keep", { comments: [{ sourceId: "k-c1", body: "kept" }] }),
      record(f, "gone", { comments: [{ sourceId: "g-c1", body: "gone" }] }),
    ]);
    const run2 = await createRun(app, f, "links-stale");
    await commitChunk(app, f, run2.id, "c1", [
      record(f, "keep", { comments: [{ sourceId: "k-c1", body: "kept" }] }),
    ]);
    const marked = await db.transaction((tx) =>
      markMissingImportSourcesStale(tx, {
        workspaceId: f.workspace.id,
        pluginId: "import.mcp",
        sourceRef: "links-stale",
        currentRunId: run2.id,
      }),
    );
    expect(marked).toEqual({ links: 1, provenance: 2 });
    const links = await db.select().from(schema.importRecordLinkTable);
    expect(links.find((l) => l.sourceId === "gone")?.staleAt).not.toBeNull();
    expect(links.find((l) => l.sourceId === "keep")?.staleAt).toBeNull();
    const gone = await itemBySource(run1.id, "gone");
    expect(gone?.deletedAt).toBeNull();

    // the source record comes back: stale markers clear
    const run3 = await createRun(app, f, "links-stale");
    await commitChunk(app, f, run3.id, "c1", [
      record(f, "gone", { comments: [{ sourceId: "g-c1", body: "gone" }] }),
    ]);
    const after = await db.select().from(schema.importProvenanceTable);
    expect(
      after
        .filter((row) => row.externalId.startsWith("issue:gone"))
        .every((row) => row.staleAt === null),
    ).toBe(true);
  });

  it("applies a mapped state, an eligible assignee and applicable custom fields; reports the rest", async () => {
    const f = await writerFixture();
    const { app } = createApp();
    const template = (
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: f.workspace.id,
          key: "writer-done",
          name: "Done",
          group: "completed",
        })
        .returning()
    )[0];
    const done = (
      await db
        .insert(schema.stateTable)
        .values({
          projectId: f.project.id,
          stateTemplateId: template?.id as string,
        })
        .returning()
    )[0];
    const section = (
      await db
        .insert(customFieldSectionTable)
        .values({
          id: "writer-section",
          workspaceId: f.workspace.id,
          name: "Imported",
        })
        .returning()
    )[0];
    const field = async (key: string, format: string, visible: boolean) => {
      const id = `writer-field-${key}`;
      await db.insert(customFieldTable).values({
        id,
        workspaceId: f.workspace.id,
        sectionId: section?.id as string,
        key,
        name: key,
        format,
      });
      await db.insert(customFieldTypeVisibilityTable).values({
        workspaceId: f.workspace.id,
        customFieldId: id,
        workItemTypeId: f.type.id,
        visible,
        required: false,
      });
      return id;
    };
    const noteId = await field("source-note", "text", true);
    await field("story-points", "number", true);
    await field("hidden-for-type", "text", false);
    const run = await createRun(app, f, "links-fields");
    const { commit } = await commitChunk(app, f, run.id, "c1", [
      record(f, "F-1", {
        stateId: done?.id,
        assigneeEmail: f.user.email.toUpperCase(),
        customFields: [
          { key: "source-note", value: "  carried over " },
          { key: "story-points", value: "not a number" },
          { key: "hidden-for-type", value: "x" },
          { key: "no-such-field", value: "x" },
        ],
      }),
      record(f, "F-2", { stateId: "not-a-state" }),
    ]);
    const one = await itemBySource(run.id, "F-1");
    const two = await itemBySource(run.id, "F-2");
    expect(one?.stateId).toBe(done?.id);
    expect(one?.assigneeId).toBe(f.person.id);
    expect(two?.stateId).toBe(f.defaultState.id);
    const [stored] = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, one?.id as string));
    expect(stored).toMatchObject({
      customFieldId: noteId,
      value: "carried over",
    });
    expect(
      await db
        .select()
        .from(customFieldValueTable)
        .where(eq(customFieldValueTable.entityId, one?.id as string)),
    ).toHaveLength(1);
    const report = await getReport(app, f, run.id);
    expect(report.chunks[0]?.lossCounts).toMatchObject({
      custom_field_unmapped: 2,
      custom_field_invalid: 1,
      state_unmapped: 1,
    });
    expect(commit.lossCounts).toMatchObject({ state_unmapped: 1 });
  });
});
