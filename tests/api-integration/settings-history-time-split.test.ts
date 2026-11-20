import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import { listSettingsHistoryRows } from "../../apps/api/src/audit/repository";
import { entityHistoryRow } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";
import { assertDisposableTestDatabaseUrl } from "./helpers/disposable-database";
import { type TimeWorld, timeWorld } from "./helpers/p5-time";

let world: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  world = await timeWorld();
});

async function patch(body: unknown) {
  return world.agent(world.owner.user, "/api/time-settings", {
    method: "PATCH",
    body,
  });
}

async function history() {
  const identity = await resolveIdentity({
    userId: world.owner.user.id,
    credential: "session",
  });
  if (!identity) throw new Error("Missing owner identity");
  const workspace = await listSettingsHistoryRows({
    identity,
    entityType: "workspace",
    entityId: world.workspaceId,
    workspaceId: world.workspaceId,
    projectId: null,
  });
  const project = await listSettingsHistoryRows({
    identity,
    entityType: "project",
    entityId: world.projectA.id,
    workspaceId: world.workspaceId,
    projectId: world.projectA.id,
  });
  return {
    workspace: workspace.filter(
      (row) => row.action === "time_settings.updated",
    ),
    project: project.filter((row) => row.action === "time_settings.updated"),
  };
}

function changedFields(
  row: Awaited<ReturnType<typeof listSettingsHistoryRows>>[number] | undefined,
  selector: "workspace" | "project",
) {
  if (!row) throw new Error("Missing time settings audit row");
  return entityHistoryRow(row, null, selector).changedFields;
}

describe("future time settings audit split on a fresh database", () => {
  it("writes one scoped row per submitted setting and projects only effective field names", async () => {
    const response = await patch({
      workspaceId: world.workspaceId,
      backdateLimitDays: 5,
      project: { id: world.projectA.id, defaultBillable: false },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    let rows = await history();
    expect(rows.workspace).toHaveLength(1);
    expect(rows.project).toHaveLength(1);
    expect(rows.workspace[0]).toMatchObject({
      entityType: "workspace",
      entityId: world.workspaceId,
      workspaceId: world.workspaceId,
      projectId: null,
      after: { operation: "workspace_time_settings_split_v1" },
    });
    expect(rows.project[0]).toMatchObject({
      entityType: "project",
      entityId: world.projectA.id,
      workspaceId: world.workspaceId,
      projectId: world.projectA.id,
      after: { operation: "project_time_settings_split_v1" },
    });
    expect(changedFields(rows.workspace[0], "workspace")).toEqual([
      "backdateLimitDays",
    ]);
    expect(changedFields(rows.project[0], "project")).toEqual([
      "projectDefaultBillable",
    ]);

    expect(
      (await patch({ workspaceId: world.workspaceId, backdateLimitDays: 5 }))
        .status,
    ).toBe(200);
    expect(
      (
        await patch({
          workspaceId: world.workspaceId,
          project: { id: world.projectA.id, defaultBillable: false },
        })
      ).status,
    ).toBe(200);
    rows = await history();
    expect(rows.workspace).toHaveLength(2);
    expect(rows.project).toHaveLength(2);
    expect(changedFields(rows.workspace[0], "workspace")).toEqual([]);
    expect(changedFields(rows.project[0], "project")).toEqual([]);
  });

  it("hides old mixed and wrong-scope rows while keeping legacy workspace action/time", async () => {
    const audit = (
      projectId: string | null,
      entityType: string,
      entityId: string,
      after: NonNullable<Parameters<typeof appendAuditLog>[1]["after"]>,
    ) =>
      appendAuditLog(db, {
        actorId: world.owner.user.id,
        actorType: "person",
        workspaceId: world.workspaceId,
        projectId,
        action: "time_settings.updated",
        entityType,
        entityId,
        before: null,
        after,
      });
    await audit(world.projectA.id, "workspace", world.workspaceId, {
      backdateLimitDays: { from: 30, to: 5 },
      projectDefaultBillable: {
        projectId: world.projectA.id,
        from: true,
        to: false,
      },
    });
    await audit(null, "workspace", world.workspaceId, {
      backdateLimitDays: { from: 30, to: 5 },
    });
    await audit(world.projectA.id, "project", world.projectA.id, {
      operation: "project_time_settings_split_v1",
      projectDefaultBillable: {
        projectId: "wrong-project",
        from: true,
        to: false,
      },
    });
    const rows = await history();
    expect(rows.workspace).toHaveLength(1);
    expect(rows.project).toHaveLength(1);
    expect(changedFields(rows.workspace[0], "workspace")).toEqual([]);
    expect(changedFields(rows.project[0], "project")).toEqual([]);
  });

  it("rolls back the workspace write when the submitted project is invalid", async () => {
    const refused = await patch({
      workspaceId: world.workspaceId,
      backdateLimitDays: 5,
      project: { id: "missing-project", defaultBillable: false },
    });
    expect(refused.status).toBe(404);
    const [workspace] = await db
      .select({ days: schema.workspaceTable.timeEntryBackdateLimitDays })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, world.workspaceId));
    expect(workspace?.days).toBe(30);
    expect((await history()).workspace).toHaveLength(0);
  });

  it("rolls both settings and the first audit row back when the second database audit append fails", async () => {
    assertDisposableTestDatabaseUrl(process.env.TASKDESK_DATABASE_URL ?? "");
    const projectId = world.projectA.id;
    const workspaceId = world.workspaceId;
    expect(workspaceId).toMatch(/^workspace-[a-f0-9-]+$/);
    if (!/^[a-z0-9-]+$/.test(projectId) || !/^[a-z0-9-]+$/.test(workspaceId))
      throw new Error("Unexpected fixture identifier shape");
    const fault = `td_p4c_audit_${randomUUID().replaceAll("-", "")}`;
    const witness = `${fault}_witness`;
    if (!/^td_p4c_audit_[a-f0-9]{32}$/.test(fault) || witness.length > 63)
      throw new Error("Unexpected synthetic identifier shape");
    const auditRows = () =>
      db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "time_settings.updated"),
            eq(schema.auditLogTable.workspaceId, workspaceId),
          ),
        );
    expect(await auditRows()).toEqual([]);
    try {
      await db.execute(sql.raw(`CREATE SEQUENCE ${witness} START 1`));
      await db.execute(
        sql.raw(`
      CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'time_settings.updated'
          AND NEW.entity_type = 'project'
          AND NEW.entity_id = TG_ARGV[0]
          AND NEW.project_id = TG_ARGV[0]
          AND NEW.workspace_id = TG_ARGV[1]
          AND NEW.after ->> 'operation' = 'project_time_settings_split_v1'
          AND EXISTS (
            SELECT 1 FROM audit_log prior
            WHERE prior.action = 'time_settings.updated'
              AND prior.entity_type = 'workspace'
              AND prior.entity_id = TG_ARGV[1]
              AND prior.workspace_id = TG_ARGV[1]
              AND prior.project_id IS NULL
              AND prior.after ->> 'operation' = 'workspace_time_settings_split_v1'
          )
          AND EXISTS (
            SELECT 1 FROM workspace
            WHERE id = TG_ARGV[1] AND time_entry_backdate_limit_days = 5
          )
          AND EXISTS (
            SELECT 1 FROM project
            WHERE id = TG_ARGV[0] AND default_billable = false
          )
        THEN
          PERFORM nextval('${witness}');
          RAISE EXCEPTION 'synthetic scoped second audit failure';
        END IF;
        RETURN NEW;
      END; $$
    `),
      );
      await db.execute(
        sql.raw(`
        CREATE TRIGGER ${fault} BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION ${fault}('${projectId}', '${workspaceId}')
      `),
      );
      const witnessState = () =>
        db.execute<{ last_value: string; is_called: boolean }>(
          sql.raw(`SELECT last_value::text, is_called FROM ${witness}`),
        );
      expect((await witnessState()).rows[0]).toMatchObject({
        last_value: "1",
        is_called: false,
      });
      const response = await patch({
        workspaceId,
        backdateLimitDays: 5,
        project: { id: projectId, defaultBillable: false },
      });
      expect(response.status).toBe(500);
      expect((await witnessState()).rows[0]).toMatchObject({
        last_value: "1",
        is_called: true,
      });
      const [workspace] = await db
        .select({ days: schema.workspaceTable.timeEntryBackdateLimitDays })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId));
      const [project] = await db
        .select({ billable: schema.projectTable.defaultBillable })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, projectId));
      expect(workspace?.days).toBe(30);
      expect(project?.billable).toBe(true);
      expect(await auditRows()).toEqual([]);
      expect(await history()).toEqual({ workspace: [], project: [] });
    } finally {
      try {
        await db.execute(
          sql.raw(`DROP TRIGGER IF EXISTS ${fault} ON audit_log`),
        );
      } finally {
        try {
          await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fault}()`));
        } finally {
          await db.execute(sql.raw(`DROP SEQUENCE IF EXISTS ${witness}`));
        }
      }
    }
  });
});
