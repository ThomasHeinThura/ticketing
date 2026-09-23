/**
 * Issue #316: backfill the default `work_item_type`/`state_template`/`state` rows for
 * workspaces and projects created BEFORE #309/#313 taught `create-workspace.ts` and
 * `create-project.ts` to seed them in their own creating transaction.
 *
 * `createWorkspaceMember`/`createProjectFixture` (`./helpers/fixtures.ts`) insert their
 * rows directly, exactly the way every workspace/project in the database was created
 * before #313 -- neither one calls the seed functions. That is this file's "legacy"
 * fixture: real rows with none of #313's seeded rows, the same shape
 * `POST /api/projects/{projectId}/work-items` fails against on an un-backfilled instance.
 *
 * The atomicity and failure-isolation probes below inject failures at the DATABASE, via a
 * `BEFORE INSERT` trigger, the same technique
 * `workspace-write-create-atomicity.test.ts` (A2) uses -- coupled to the transaction
 * boundary and the target table, not to any function name or call order, so a refactor
 * that keeps the guarantee keeps these green.
 */
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { backfillWorkspaceAndProjectDefaults } from "../../apps/api/src/utils/backfill-workspace-project-defaults";
import { DEFAULT_STATE_TEMPLATES } from "../../apps/api/src/utils/default-state-templates";
import { DEFAULT_WORK_ITEM_TYPES } from "../../apps/api/src/utils/default-work-item-types";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

const FAIL_FUNCTION = "td_probe_316_fail_insert";

/** Raise inside PostgreSQL on every INSERT into `table` -- same idiom as
 * `workspace-write-create-atomicity.test.ts`'s `armInsertFailure`. */
async function armInsertFailure(table: string) {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${FAIL_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'issue #316 probe: injected % insert failure', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${FAIL_FUNCTION}_${table}
      BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION ${FAIL_FUNCTION}();
    `),
  );
}

async function disarmInsertFailure(table: string) {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${FAIL_FUNCTION}_${table} ON "${table}"`),
  );
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: backfill legacy workspace/project defaults (#316)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("backfills a legacy workspace's types/templates and a legacy project's states, and work-item creation then succeeds", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    // Pre-backfill: exactly the failure #316 exists to fix.
    const typesBefore = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(typesBefore).toHaveLength(0);
    const statesBefore = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(statesBefore).toHaveLength(0);

    const summary = await backfillWorkspaceAndProjectDefaults();
    expect(summary.workspaces.failed).toBe(0);
    expect(summary.projects.failed).toBe(0);

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(types).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
    expect(new Set(types.map((t) => t.key))).toEqual(
      new Set(DEFAULT_WORK_ITEM_TYPES.map((t) => t.key)),
    );

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
    const defaults = states.filter((s) => s.isDefault);
    expect(defaults).toHaveLength(1);

    const taskType = types.find((t) => t.key === "task");
    expect(taskType).toBeTruthy();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await createWorkItemRequest(app, project.id, {
      typeId: taskType?.id,
      title: "Printer is on fire",
    });
    expect(response.status).toBe(200);
    const workItem = (await response.json()) as {
      key: string;
      stateId: string;
    };
    expect(workItem.key).toBe(`${project.slug}-1`);
    expect(workItem.stateId).toBe(defaults[0]?.id);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await backfillWorkspaceAndProjectDefaults();

    const typesBefore = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    const templatesBefore = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    const statesBefore = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    await backfillWorkspaceAndProjectDefaults();

    const typesAfter = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    const templatesAfter = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    const statesAfter = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });

    expect(new Set(typesAfter.map((t) => t.id))).toEqual(
      new Set(typesBefore.map((t) => t.id)),
    );
    expect(new Set(templatesAfter.map((t) => t.id))).toEqual(
      new Set(templatesBefore.map((t) => t.id)),
    );
    expect(new Set(statesAfter.map((s) => s.id))).toEqual(
      new Set(statesBefore.map((s) => s.id)),
    );
    expect(statesAfter.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("seeds only the missing kind: a workspace with its own types gets templates seeded, types untouched", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const [customType] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-triage",
        name: "Triage",
        category: "service",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customType).toBeTruthy();

    const summary = await backfillWorkspaceAndProjectDefaults();
    expect(summary.workspaces.typesSeeded).toBe(0);
    expect(summary.workspaces.templatesSeeded).toBe(1);

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    // Untouched: still exactly the operator's one custom type, none of the 9
    // defaults added alongside it.
    expect(types).toHaveLength(1);
    expect(types[0]?.key).toBe("custom-triage");

    // But the OTHER kind, which the workspace had none of, is seeded -- the per-kind
    // guard (independent review of this PR, first round), not a whole-workspace guard.
    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
  });

  it("seeds only the missing kind: a workspace with its own templates gets types seeded, templates untouched", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    const [customTemplate] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-triaging",
        name: "Triaging",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customTemplate).toBeTruthy();

    const summary = await backfillWorkspaceAndProjectDefaults();
    expect(summary.workspaces.templatesSeeded).toBe(0);
    expect(summary.workspaces.typesSeeded).toBe(1);

    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]?.key).toBe("custom-triaging");

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(types).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
  });

  it("touches neither kind when a workspace already has both a custom type and a custom template", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const now = new Date();
    await db.insert(schema.workItemTypeTable).values({
      workspaceId: member.workspace.id,
      key: "custom-triage",
      name: "Triage",
      category: "service",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.stateTemplateTable).values({
      workspaceId: member.workspace.id,
      key: "custom-triaging",
      name: "Triaging",
      group: "started",
      createdAt: now,
      updatedAt: now,
    });

    const summary = await backfillWorkspaceAndProjectDefaults();
    expect(summary.workspaces.processed).toBe(0);

    const types = await db.query.workItemTypeTable.findMany({
      where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
    });
    expect(types).toHaveLength(1);
    const templates = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    expect(templates).toHaveLength(1);
  });

  it("never touches a project that already has its own state row", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const now = new Date();
    const [customTemplate] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: member.workspace.id,
        key: "custom-state",
        name: "Custom",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!customTemplate) throw new Error("insert returned no row");

    const [customState] = await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: customTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    expect(customState).toBeTruthy();

    await backfillWorkspaceAndProjectDefaults();

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    // Untouched: still exactly the operator's one custom state. The workspace itself
    // had no types/templates of its own, so it DOES get backfilled -- only the
    // already-stated project is left alone.
    expect(states).toHaveLength(1);
    expect(states[0]?.id).toBe(customState?.id);
  });

  it("a concurrent backfill run does not double-seed a legacy project's states", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    // Backfill the workspace itself first, so both concurrent runs below are racing
    // only on the PROJECT's state seeding -- the thing #313's Opus review (S2) flagged
    // as unsafe outside the creator's own advisory lock.
    await backfillWorkspaceAndProjectDefaults();
    const templatesBefore = await db.query.stateTemplateTable.findMany({
      where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
    });
    await db
      .delete(schema.stateTable)
      .where(eq(schema.stateTable.projectId, project.id));

    await Promise.all(
      Array.from({ length: 30 }, () => backfillWorkspaceAndProjectDefaults()),
    );

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(templatesBefore.length);
    expect(states.filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("skips a soft-deleted legacy project", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    await backfillWorkspaceAndProjectDefaults();

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(0);
  });

  it("excludes a legacy project from the query when its workspace has no active state_template", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    // Seed the workspace's templates, then archive every one of them -- the same
    // "workspace with zero ACTIVE templates" shape `seed-project-states.ts`'s own
    // "nothing to adopt yet" branch guards against.
    await backfillWorkspaceAndProjectDefaults();
    await db
      .update(schema.stateTemplateTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.stateTemplateTable.workspaceId, member.workspace.id));
    await db
      .delete(schema.stateTable)
      .where(eq(schema.stateTable.projectId, project.id));

    const summary = await backfillWorkspaceAndProjectDefaults();
    expect(summary.projects.seeded).toBe(0);
    expect(summary.projects.failed).toBe(0);
    expect(summary.projects.skippedNoActiveTemplate).toBe(1);

    const states = await db.query.stateTable.findMany({
      where: eq(schema.stateTable.projectId, project.id),
    });
    expect(states).toHaveLength(0);
  });

  describe("atomicity and failure isolation (independent review of this PR, first round)", () => {
    it("BLOCKING regression: a failure between the type insert and the template insert leaves nothing committed, and the next run completes the workspace", async () => {
      const member = await createWorkspaceMember({ role: "member" });

      // Fails the SECOND of the two inserts a workspace's backfill makes -- exactly the
      // window the review reproduced live against the pre-fix code (9 types committed,
      // 0 templates, permanently skipped afterwards because the guard then saw a type
      // row).
      await armInsertFailure("state_template");
      try {
        const summary = await backfillWorkspaceAndProjectDefaults();
        expect(summary.workspaces.failed).toBe(1);
        expect(summary.workspaces.typesSeeded).toBe(0);
        expect(summary.workspaces.templatesSeeded).toBe(0);

        // Nothing committed: the type insert that ran BEFORE the failing template
        // insert must have rolled back with it, not survived as a half-seeded state.
        const typesDuringFailure = await db.query.workItemTypeTable.findMany({
          where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
        });
        expect(typesDuringFailure).toHaveLength(0);
        const templatesDuringFailure =
          await db.query.stateTemplateTable.findMany({
            where: eq(
              schema.stateTemplateTable.workspaceId,
              member.workspace.id,
            ),
          });
        expect(templatesDuringFailure).toHaveLength(0);
      } finally {
        await disarmInsertFailure("state_template");
      }

      // The failed workspace was left exactly as found (no type row), so the per-kind
      // guard re-selects it on the next run -- retried, not skipped forever.
      const retrySummary = await backfillWorkspaceAndProjectDefaults();
      expect(retrySummary.workspaces.failed).toBe(0);
      expect(retrySummary.workspaces.typesSeeded).toBe(1);
      expect(retrySummary.workspaces.templatesSeeded).toBe(1);

      const types = await db.query.workItemTypeTable.findMany({
        where: eq(schema.workItemTypeTable.workspaceId, member.workspace.id),
      });
      expect(types).toHaveLength(DEFAULT_WORK_ITEM_TYPES.length);
      const templates = await db.query.stateTemplateTable.findMany({
        where: eq(schema.stateTemplateTable.workspaceId, member.workspace.id),
      });
      expect(templates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
    });

    it("isolates a per-workspace failure: one workspace's failure does not stop another workspace's backfill", async () => {
      const failing = await createWorkspaceMember({
        role: "member",
        workspaceName: "Failing Co",
      });
      const healthy = await createWorkspaceMember({
        role: "member",
        workspaceName: "Healthy Co",
      });
      // `healthy` already has its own custom type, so ITS backfill only touches
      // `state_template` -- untouched by the `work_item_type` failure trigger below,
      // which only fires for `failing`'s (fresh, needs-both) type insert.
      const now = new Date();
      await db.insert(schema.workItemTypeTable).values({
        workspaceId: healthy.workspace.id,
        key: "custom-type",
        name: "Custom",
        category: "service",
        createdAt: now,
        updatedAt: now,
      });

      await armInsertFailure("work_item_type");
      let summary: Awaited<
        ReturnType<typeof backfillWorkspaceAndProjectDefaults>
      >;
      try {
        summary = await backfillWorkspaceAndProjectDefaults();
      } finally {
        await disarmInsertFailure("work_item_type");
      }

      // Both workspaces had work to do; ONE failed, but the other still completed in
      // the same run -- a bad row in one tenant's workspace must not abort the boot
      // for every other tenant.
      expect(summary.workspaces.processed).toBe(2);
      expect(summary.workspaces.failed).toBe(1);
      expect(summary.workspaces.typesSeeded).toBe(0);
      expect(summary.workspaces.templatesSeeded).toBe(1);

      const failingTypes = await db.query.workItemTypeTable.findMany({
        where: eq(schema.workItemTypeTable.workspaceId, failing.workspace.id),
      });
      expect(failingTypes).toHaveLength(0);
      const failingTemplates = await db.query.stateTemplateTable.findMany({
        where: eq(schema.stateTemplateTable.workspaceId, failing.workspace.id),
      });
      // The failing workspace's template insert is never even reached: the type
      // insert (attempted first) already threw and aborted the transaction.
      expect(failingTemplates).toHaveLength(0);

      const healthyTemplates = await db.query.stateTemplateTable.findMany({
        where: eq(schema.stateTemplateTable.workspaceId, healthy.workspace.id),
      });
      expect(healthyTemplates).toHaveLength(DEFAULT_STATE_TEMPLATES.length);
    });
  });
});
