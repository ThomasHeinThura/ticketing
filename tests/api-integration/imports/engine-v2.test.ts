import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../../apps/api/src/database/migration-schema";
import { importLossTable } from "../../../apps/api/src/database/schema-imports";
import {
  registerImportAdapter,
  type SourceRecord,
  unregisterImportAdapter,
} from "../../../apps/api/src/imports/engine/adapter";
import {
  runImportRun,
  setImportEngineAutoStart,
} from "../../../apps/api/src/imports/engine/runner";
import {
  clearFakeFixtures,
  createFakeAdapter,
} from "../../../apps/api/src/imports/engine/test-adapter";
import { setImportAttachmentDependencies } from "../../../apps/api/src/imports/writer";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import {
  call,
  discoverAndWait,
  dryRunAndExecuteBody,
  engineFixture,
  makeRecords,
  post,
  req,
  setFakeFixture,
} from "./engine-helpers";

// The fixture source registers as `import.csv` so the run carries a real plugin id: the digest,
// the run DTO and the guards must all use it (never the retained `import.mcp`).
const PLUGIN = "import.csv" as const;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
]);
let root: string;
// biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;

beforeEach(async () => {
  await resetTestDatabase();
  setImportEngineAutoStart(false);
  clearFakeFixtures();
  root = await mkdtemp(path.join(tmpdir(), "p6int-v2-"));
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  registerImportAdapter(PLUGIN, () => ({
    ...createFakeAdapter(PLUGIN, 10),
    attachmentAuth: () => ({
      headers: { authorization: "Bearer fixture-token" },
      hosts: ["files.source.example.test"],
    }),
  }));
});
afterEach(async () => {
  setImportAttachmentDependencies(null);
  unregisterImportAdapter(PLUGIN);
  await rm(root, { recursive: true, force: true });
  if (originalRoot === undefined)
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the test sets this environment value for itself.
    delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  else process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
});

type F = Awaited<ReturnType<typeof engineFixture>>;
// biome-ignore lint/suspicious/noExplicitAny: loose JSON assertions
type Json = Record<string, any>;

async function fields(f: F) {
  const section = (
    await db
      .insert(customFieldSectionTable)
      .values({ id: "v2-section", workspaceId: f.workspace.id, name: "Src" })
      .returning()
  )[0];
  const make = async (key: string, format: string) => {
    const id = `v2-field-${key}`;
    await db.insert(customFieldTable).values({
      id,
      workspaceId: f.workspace.id,
      sectionId: section?.id as string,
      key: `dest-${key}`,
      name: key,
      format,
    });
    await db.insert(customFieldTypeVisibilityTable).values({
      workspaceId: f.workspace.id,
      customFieldId: id,
      workItemTypeId: f.type.id,
      visible: true,
      required: false,
    });
    return id;
  };
  return {
    text: await make("sev", "text"),
    number: await make("points", "number"),
  };
}

async function startedState(f: F) {
  const template = (
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: f.workspace.id,
        key: "v2-started",
        name: "In Progress",
        group: "started",
      })
      .returning()
  )[0];
  return (
    await db
      .insert(schema.stateTable)
      .values({
        projectId: f.project.id,
        stateTemplateId: template?.id as string,
      })
      .returning()
  )[0]?.id as string;
}

function v2Records(typeKey: string): SourceRecord[] {
  const base = makeRecords(typeKey, 4, { state: () => "In Progress" });
  const [one, two, three, four] = base as [
    SourceRecord,
    SourceRecord,
    SourceRecord,
    SourceRecord,
  ];
  return [
    {
      ...one,
      sourceCreatedAt: "2021-03-04T05:06:07.000Z",
      sourceUpdatedAt: "2021-04-04T05:06:07.000Z",
      sourceResolvedAt: "2021-05-04T05:06:07.000Z",
      sourceAuthorName: "Original Author",
      requester: { email: "requester@example.test" },
      facets: [
        ...one.facets,
        { domain: "custom_field", value: "sev" },
        { domain: "custom_field", value: "points" },
      ],
      customFields: [
        { key: "sev", value: "high" },
        { key: "points", value: "not-a-number" },
      ],
      comments: [
        { sourceId: "c1", body: "Public note", visibility: "public" },
        { sourceId: "c2", body: "Internal note" },
      ],
      attachments: [
        {
          sourceId: "a1",
          url: "https://files.source.example.test/a1.png",
          filename: "a1.png",
        },
      ],
      relations: [
        { type: "blocks", target: { sourceType: "issue", sourceId: "SRC-2" } },
      ],
      history: [
        {
          sourceId: "h1",
          at: "2021-03-05T05:06:07.000Z",
          field: "state",
          from: "To Do",
          to: "In Progress",
        },
      ],
    },
    { ...two, parentSourceId: "SRC-1" },
    {
      ...three,
      // One bad comment and one attachment with a credential-like query key must not reject the item.
      comments: [{ sourceId: "bad", body: "" } as never],
      attachments: [
        {
          sourceId: "sig",
          url: "https://files.source.example.test/x.png?sig=abc",
          filename: "x.png",
        },
      ],
    },
    { ...four, rejectCode: "adapter_rejected" },
  ];
}

async function start(
  f: F,
  app: ReturnType<typeof createApp>["app"],
  id: string,
) {
  const source = await call(
    app,
    f.key,
    "/api/import-sources",
    post({
      workspaceId: f.workspace.id,
      pluginId: PLUGIN,
      name: `${id}-${randomUUID()}`,
      config: { fixture: id },
    }),
    200,
  );
  const run = await call(
    app,
    f.key,
    `/api/import-sources/${source.id}/runs`,
    post({ projectId: f.project.id, sourceRef: id }),
    200,
  );
  const mapping = await discoverAndWait(app, f.key, run.id);
  return { run, mapping };
}

async function mapAndDryRun(
  f: F,
  app: ReturnType<typeof createApp>["app"],
  runId: string,
  version: number,
  entries: Json[] = [],
) {
  await call(
    app,
    f.key,
    `/api/imports/${runId}/mapping`,
    post({ expectedMappingVersion: version, entries, confirmProposals: true }),
    200,
  );
  return dryRunAndExecuteBody(app, f.key, runId);
}

describe("import engine: record v2 members through the writer", () => {
  it("writes state, parent, relations, comments, attachments, history, custom fields and timestamps, and reports the rest", async () => {
    const f = await engineFixture();
    const stateId = await startedState(f);
    const fieldIds = await fields(f);
    const auth: Json[] = [];
    setImportAttachmentDependencies({
      download: vi.fn(async (_url: string, options: { auth?: Json | null }) => {
        auth.push(options.auth ?? {});
        return { ok: true as const, bytes: PNG, contentType: "image/png" };
      }),
    });
    setFakeFixture("v2", { records: v2Records(f.type.key) });
    const { app } = createApp();
    const { run, mapping } = await start(f, app, "v2");
    const dry = await mapAndDryRun(f, app, run.id, mapping.mappingVersion, [
      {
        domain: "custom_field",
        value: "sev",
        target: { kind: "target", id: fieldIds.text },
      },
      {
        domain: "custom_field",
        value: "points",
        target: { kind: "target", id: fieldIds.number },
      },
    ]);
    // The dry run already reports the writer-unavailable member and the explicit adapter reject.
    expect(dry.report.rejectionCodes).toMatchObject({ adapter_rejected: 1 });
    await call(
      app,
      f.key,
      `/api/imports/${run.id}/execute`,
      post(dry.body),
      202,
    );
    expect(await runImportRun(run.id)).toMatchObject({ status: "completed" });

    // The run reports its real plugin (not import.mcp).
    const listed = await call(
      app,
      f.key,
      `/api/imports/${run.id}`,
      undefined,
      200,
    );
    expect(listed.pluginId).toBe(PLUGIN);

    const items = await db.select().from(schema.workItemTable);
    expect(items).toHaveLength(3);
    const one = items.find((i) => i.title === "Imported SRC 1");
    const two = items.find((i) => i.title === "Imported SRC 2");
    expect(one?.stateId).toBe(stateId);
    expect(two?.parentId).toBe(one?.id);
    const relations = await db.select().from(schema.workItemRelationTable);
    expect(relations).toMatchObject([
      { sourceId: one?.id, targetId: two?.id, type: "blocks" },
    ]);
    const comments = await db
      .select()
      .from(schema.commentTable)
      .where(eq(schema.commentTable.workItemId, one?.id as string));
    expect(comments.map((c) => c.visibility).sort()).toEqual([
      "internal",
      "public",
    ]);
    const values = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, one?.id as string));
    expect(values.map((v) => v.customFieldId)).toEqual([fieldIds.text]);
    const attachments = await db.select().from(schema.attachmentTable);
    expect(attachments).toHaveLength(1);
    // Credentials come from the adapter at download time and go only to its host.
    expect(auth).toEqual([
      {
        headers: { authorization: "Bearer fixture-token" },
        hosts: ["files.source.example.test"],
      },
    ]);
    const provenance = (
      await db.select().from(schema.importProvenanceTable)
    ).find((p) => p.entityType === "work_item" && p.workItemId === one?.id);
    expect(provenance?.sourceResolvedAt?.toISOString()).toBe(
      "2021-05-04T05:06:07.000Z",
    );

    // Nothing the writer could not take is silent: every member shows up in the per-run loss report.
    const losses = await db
      .select()
      .from(importLossTable)
      .where(eq(importLossTable.importRunId, run.id));
    const has = (code: string, detail = "") =>
      losses.some((l) => l.code === code && l.detailCode === detail);
    expect(has("writer_unavailable", "requester")).toBe(true);
    expect(has("comment_invalid")).toBe(true);
    expect(has("attachment_invalid")).toBe(true);
    expect(has("record_rejected", "adapter_rejected")).toBe(true);
    // Writer-side loss (a number field given text) reaches import_loss, not only the chunk report.
    expect(has("custom_field_invalid", "custom_field")).toBe(true);
    for (const row of losses)
      expect(JSON.stringify(row)).not.toContain("fixture-token");
  });

  it("refuses the retained chunk routes on an engine run", async () => {
    const f = await engineFixture();
    setFakeFixture("guard", { records: makeRecords(f.type.key, 2) });
    const { app } = createApp();
    const { run } = await start(f, app, "guard");
    const body = {
      chunkId: "c1",
      expectedVersion: 1,
      records: [
        {
          sourceType: "issue",
          sourceId: "X",
          item: { typeId: f.type.id, title: "x" },
        },
      ],
    };
    for (const [path, payload] of [
      [`/api/imports/${run.id}/dry-run`, body],
      [
        `/api/imports/${run.id}/records`,
        { ...body, previewDigest: "a".repeat(64) },
      ],
      [
        `/api/imports/${run.id}/links`,
        {
          links: [
            {
              sourceType: "issue",
              sourceId: "X",
              targetType: "work_item",
              targetId: "t",
            },
          ],
        },
      ],
    ] as const)
      expect((await req(app, f.key, path, post(payload))).status, path).toBe(
        409,
      );
    expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
  });

  it("marks sources missing from a full run stale, but not a record that was only rejected", async () => {
    const f = await engineFixture();
    await startedState(f);
    setFakeFixture("stale", { records: makeRecords(f.type.key, 4) });
    const { app } = createApp();
    const first = await start(f, app, "stale");
    const dry1 = await mapAndDryRun(
      f,
      app,
      first.run.id,
      first.mapping.mappingVersion,
    );
    await call(
      app,
      f.key,
      `/api/imports/${first.run.id}/execute`,
      post(dry1.body),
      202,
    );
    expect(await runImportRun(first.run.id)).toMatchObject({
      status: "completed",
    });
    const stale = async () =>
      (await db.select().from(schema.importRecordLinkTable))
        .filter((l) => l.staleAt !== null)
        .map((l) => l.sourceId)
        .sort();
    expect(await stale()).toEqual([]);

    // Second run, same sourceRef: SRC-4 is gone from the source, SRC-3 is rejected by the adapter.
    const again = makeRecords(f.type.key, 3);
    again[2] = {
      ...(again[2] as SourceRecord),
      rejectCode: "adapter_rejected",
    };
    setFakeFixture("stale", { records: again });
    const second = await start(f, app, "stale");
    const dry2 = await mapAndDryRun(
      f,
      app,
      second.run.id,
      second.mapping.mappingVersion,
    );
    await call(
      app,
      f.key,
      `/api/imports/${second.run.id}/execute`,
      post(dry2.body),
      202,
    );
    expect(await runImportRun(second.run.id)).toMatchObject({
      status: "completed",
    });
    expect(await stale()).toEqual(["SRC-4"]);
  });
});
