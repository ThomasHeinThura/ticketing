import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { cleanupExpiredImportChunks } from "../../apps/api/src/imports/expiry-cleanup";
import { retireImportProjectTargets } from "../../apps/api/src/imports/project-retention";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
} from "../../apps/api/src/pending-action/payload";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function fixture() {
  const { workspace } = await createWorkspaceMember();
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  const run = requireRow(
    await db
      .insert(schema.importRunTable)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        pluginId: "import.mcp",
        sourceRef: "persistence-fixture",
      })
      .returning(),
    "import run",
  );
  return { workspace, project, run };
}

async function chunks(runId: string) {
  return db
    .insert(schema.importChunkTable)
    .values([
      {
        importRunId: runId,
        chunkId: "preview",
        sequence: 0,
        expectedRunVersion: 1,
        inputDigest: "a".repeat(64),
        inputPayload: { records: [{ title: "private staged title" }] },
        report: {
          counts: { created: 1 },
          rows: [{ sourceId: "private-source" }],
        },
        recordCount: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        importRunId: runId,
        chunkId: "committed",
        sequence: 1,
        expectedRunVersion: 1,
        inputDigest: "b".repeat(64),
        state: "committed" as const,
        committedAt: new Date(),
        report: { counts: { created: 1 } },
        recordCount: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])
    .returning();
}

describe("import persistence and destination retention", () => {
  beforeEach(resetTestDatabase);

  it("rejects a destination project from another workspace", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(
      db.insert(schema.importRunTable).values({
        workspaceId: a.workspace.id,
        projectId: b.project.id,
        pluginId: "import.mcp",
        sourceRef: "foreign-project",
      }),
    ).rejects.toThrow();
  });

  it("binds ledger identities to the run workspace and source", async () => {
    const { workspace, run } = await fixture();
    await expect(
      db.insert(schema.importRecordLinkTable).values({
        workspaceId: workspace.id,
        importRunId: run.id,
        firstImportRunId: run.id,
        pluginId: "import.mcp",
        sourceRef: "different-source",
        sourceType: "issue",
        sourceId: "1",
        targetType: "work_item",
        targetId: "target",
      }),
    ).rejects.toThrow();
  });

  it("rejects chunks above the server cap and malformed digests", async () => {
    const { run } = await fixture();
    const base = {
      importRunId: run.id,
      chunkId: "invalid",
      sequence: 0,
      expectedRunVersion: 1,
      inputDigest: "a".repeat(64),
      recordCount: 501,
      expiresAt: new Date(),
    };
    await expect(
      db.insert(schema.importChunkTable).values(base),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.importChunkTable)
        .values({ ...base, recordCount: 1, inputDigest: "invalid" }),
    ).rejects.toThrow();
  });

  it("retires a purged destination, clears staged bytes and preserves committed history", async () => {
    const { project, run } = await fixture();
    await chunks(run.id);
    await db.transaction(async (tx) => {
      await retireImportProjectTargets(tx, [project.id]);
      await tx
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id));
    });
    const [retained] = await db
      .select()
      .from(schema.importRunTable)
      .where(eq(schema.importRunTable.id, run.id));
    expect(retained).toMatchObject({
      projectId: null,
      state: "failed",
      version: 2,
      dryRunDigest: null,
    });
    const records = await db
      .select()
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.importRunId, run.id));
    expect(records.find((row) => row.chunkId === "preview")).toMatchObject({
      state: "failed",
      inputPayload: null,
      report: { counts: { created: 1 }, code: "target_project_purged" },
    });
    expect(JSON.stringify(records)).not.toContain("private");
    expect(records.find((row) => row.chunkId === "committed")?.state).toBe(
      "committed",
    );
  });

  it("runs destination retirement through the actual soft-delete purge hook", async () => {
    const { project, run } = await fixture();
    await chunks(run.id);
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(Date.now() - 31 * 86400_000),
        purgeAfter: new Date(Date.now() - 86400_000),
      })
      .where(eq(schema.projectTable.id, project.id));
    const result = await purgeSoftDeletedRows();
    expect(result.failed).toBe(0);
    expect(
      await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id)),
    ).toHaveLength(0);
    const [retained] = await db
      .select()
      .from(schema.importRunTable)
      .where(eq(schema.importRunTable.id, run.id));
    expect(retained).toMatchObject({ projectId: null, state: "failed" });
  });

  it("cascades source profiles, runs, chunks and ledger when the workspace is physically removed", async () => {
    const { workspace, project, run } = await fixture();
    await chunks(run.id);
    await db.insert(schema.importRecordLinkTable).values({
      workspaceId: workspace.id,
      importRunId: run.id,
      firstImportRunId: run.id,
      pluginId: run.pluginId,
      sourceRef: run.sourceRef,
      sourceType: "issue",
      sourceId: "1",
      targetType: "work_item",
      targetId: "target",
    });
    await db.insert(schema.importMappingProfileTable).values({
      workspaceId: workspace.id,
      pluginId: run.pluginId,
      sourceRef: run.sourceRef,
      name: "Canonical",
      mapping: { version: 1, mode: "canonical" },
    });
    await db.transaction(async (tx) => {
      await retireImportProjectTargets(tx, [project.id]);
      await tx
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, project.id));
      await tx
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspace.id));
    });
    expect(await db.select().from(schema.importRunTable)).toHaveLength(0);
    expect(await db.select().from(schema.importChunkTable)).toHaveLength(0);
    expect(await db.select().from(schema.importRecordLinkTable)).toHaveLength(
      0,
    );
    expect(
      await db.select().from(schema.importMappingProfileTable),
    ).toHaveLength(0);
  });
  it("scrubs expired previews but preserves fresh previews and pending approvals", async () => {
    const { run } = await fixture();
    const base = {
      importRunId: run.id,
      expectedRunVersion: 1,
      inputDigest: "c".repeat(64),
      recordCount: 1,
      inputPayload: { records: [{ title: "private staged content" }] },
      report: {
        counts: { rejected: 1 },
        rows: [{ sourceId: "private", code: "invalid_target_record" }],
      },
      expiresAt: new Date(Date.now() - 60_000),
    };
    const person = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .limit(1),
      "cleanup requester",
    );
    const payload = canonicalPendingActionPayload({
      action: "mcp_destructive",
      route_key: "POST /api/imports/{id}/records",
      target_type: "import_chunk",
      target_ids: ["pending"],
      workspace_id: run.workspaceId,
      project_id: run.projectId,
      organisation_id: null,
      confirmation_required: "typed_count_step_up",
    });
    const approval = requireRow(
      await db
        .insert(schema.pendingActionTable)
        .values({
          requestedByPersonId: person.id,
          credentialType: "session",
          origin: "web",
          action: payload.action,
          targetType: payload.target_type,
          targetIds: payload.target_ids,
          payload,
          routeKey: payload.route_key,
          payloadHash: hashPendingActionPayload(payload),
          payloadSummary: {
            kind: "mcp_import_chunk",
            operation: "records",
            recordCount: 51,
            pluginId: "import.mcp",
          },
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          confirmationRequired: payload.confirmation_required,
          expiresAt: new Date(Date.now() + 60_000),
          traceId: "import-cleanup-fixture",
        })
        .returning(),
      "live import approval",
    );
    await db.insert(schema.importChunkTable).values([
      { ...base, chunkId: "expired", sequence: 0 },
      {
        ...base,
        chunkId: "fresh",
        sequence: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        ...base,
        chunkId: "pending",
        sequence: 2,
        state: "pending_approval",
        pendingActionId: approval.id,
      },
    ]);
    expect(await cleanupExpiredImportChunks()).toBe(1);
    const rows = await db
      .select()
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.importRunId, run.id));
    const expired = rows.find((row) => row.chunkId === "expired");
    expect(expired).toMatchObject({
      inputPayload: null,
      report: {
        counts: { rejected: 1 },
        rows: [],
        rejectionCodes: { invalid_target_record: 1 },
      },
    });
    expect(JSON.stringify(expired)).not.toContain("private");
    expect(
      rows.find((row) => row.chunkId === "fresh")?.inputPayload,
    ).not.toBeNull();
    expect(
      rows.find((row) => row.chunkId === "pending")?.inputPayload,
    ).not.toBeNull();
    expect(await cleanupExpiredImportChunks()).toBe(0);
    await db
      .update(schema.pendingActionTable)
      .set({ state: "cancelled", decidedAt: new Date() })
      .where(eq(schema.pendingActionTable.id, approval.id));
    expect(await cleanupExpiredImportChunks()).toBe(1);
    const [scrubbed] = await db
      .select()
      .from(schema.importChunkTable)
      .where(eq(schema.importChunkTable.pendingActionId, approval.id));
    expect(scrubbed?.inputPayload).toBeNull();
    expect(JSON.stringify(scrubbed)).not.toContain("private");
  });
});
