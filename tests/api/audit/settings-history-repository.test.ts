import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../../apps/api/src/audit/repository";
import { servicePrincipalFromFacts } from "../../../apps/api/src/permissions/service-principal";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

function captureQueries() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const executor = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { queries, executor };
}

const owner = identityFor("owner");
const serviceKey = servicePrincipalFromFacts({
  apiKeyId: "key-1",
  workspaceId: "w1",
  capabilities: ["workspace:manage_settings"],
  organisationId: "org-1",
});
if (!serviceKey) throw new Error("Service identity fixture failed");

describe("settings history repository scope", () => {
  it.each([
    ["workspace_member", "workspace_member", "user-1", null],
    ["project_membership", "membership", "person-1", "p1"],
  ] as const)(
    "rechecks %s row, subject, role change and current reach in rows and actor names",
    async (entityType, table, auditEntityId, projectId) => {
      const { executor, queries } = captureQueries();
      const input = {
        identity: owner,
        entityType,
        entityId: "membership-row-1",
        auditEntityId,
        workspaceId: "w1",
        projectId,
      };
      await listSettingsHistoryRows(input, executor as never);
      await listSettingsHistoryActorNames(
        input,
        ["actor-1"],
        executor as never,
      );
      expect(queries).toHaveLength(2);
      for (const query of queries) {
        expect(query.sql).toContain(`from "${table}"`);
        expect(query.sql).toContain('from "membership"');
        expect(query.sql).toContain('"audit_log"."workspace_id" =');
        expect(query.sql).toContain('"audit_log"."entity_id" =');
        expect(query.sql).toContain("jsonb_typeof");
        expect(query.sql).toContain("is distinct from");
        expect(query.params).toContain("membership-row-1");
        expect(query.params).toContain(auditEntityId);
        expect(query.params).toContain("w1");
        if (projectId) {
          expect(query.sql).toContain('from "membership_grant"');
          expect(query.sql).toContain('"membership_grant"."membership_id" =');
          expect(query.sql).toContain('"audit_log"."project_id" =');
          expect(query.sql).toContain("project_roster");
          expect(query.sql).toContain("role_changed");
          expect(query.params).toContain(projectId);
        } else {
          expect(query.sql).toContain('"audit_log"."project_id" is null');
          expect(query.sql).toContain("member_role_changed");
        }
      }
    },
  );

  it("fails closed without a trusted P2 subject and keeps workspace member history session-only", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "workspace_member",
        entityId: "row-1",
        workspaceId: "w1",
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      {
        identity: serviceKey,
        entityType: "workspace_member",
        entityId: "row-1",
        auditEntityId: "user-1",
        workspaceId: "w1",
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "project_membership",
        entityId: "row-1",
        workspaceId: "w1",
        projectId: "p1",
      },
      executor as never,
    );
    expect(queries).toHaveLength(3);
    for (const query of queries) expect(query.sql).toContain("false");
  });

  it.each([
    ["role", "role"],
    ["workflow", "workflow"],
    ["team", "team"],
    ["service_calendar", "service_calendar"],
    ["sla_policy", "sla_policy"],
    ["request_type", "request_type"],
    ["custom_field", "custom_field"],
    ["custom_field_section", "custom_field_section"],
    ["state_template", "state_template"],
    ["webhook", "webhook"],
    ["canned_response", "canned_response"],
  ] as const)("checks the current %s target row", async (entityType, table) => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      { identity: owner, entityType, entityId: "target-1", workspaceId: "w1" },
      executor as never,
    );
    expect(queries[0]?.sql).toContain(`from "${table}"`);
    expect(queries[0]?.sql).toContain('from "workspace"');
    expect(queries[0]?.params).toContain("target-1");
  });

  it("excludes project-scoped rows and rechecks workspace reach and target existence", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "workspace",
        entityId: "w1",
        workspaceId: "w1",
      },
      executor as never,
    );
    const query = queries[0];
    expect(query?.sql).toContain('"audit_log"."project_id" is null');
    expect(query?.sql).toContain('from "workspace"');
    expect(query?.sql).toContain('from "membership"');
    expect(query?.params).toContain("w1");
  });

  it("keys project history to the reached live project even after a workspace move", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "project",
        entityId: "p1",
        workspaceId: "new-w",
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain('"audit_log"."project_id" =');
    expect(queries[0]?.sql).toContain('"audit_log"."workspace_id" =');
    expect(queries[0]?.sql).toContain('"project"."deleted_at" is null');
    expect(queries[0]?.sql).toContain('from "membership"');
    expect(queries[0]?.params).toContain("new-w");
  });

  it("separates workspace and project label catalogues from task assignments", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "workspace_label",
        entityId: "l1",
        workspaceId: "w1",
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "project_label",
        entityId: "l2",
        workspaceId: "w1",
        projectId: "p1",
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain('"label"."task_id" is null');
    expect(queries[0]?.sql).toContain('"label"."project_id" is null');
    expect(queries[1]?.sql).toContain('"label"."task_id" is null');
    expect(queries[1]?.sql).toContain('"label"."project_id" =');
  });

  it("rechecks a service key's enabled and extension state in both data and actor-name SQL", async () => {
    const { executor, queries } = captureQueries();
    const input = {
      identity: serviceKey,
      entityType: "workspace" as const,
      entityId: "w1",
      workspaceId: "w1",
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor-1"], executor as never);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('"apikey"."enabled" =');
      expect(query.sql).toContain('"api_key"."disabled_at" is null');
      expect(query.params).toContain("key-1");
    }
  });

  it("rechecks project reach and target existence in the correlated actor-name SELECT", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryActorNames(
      {
        identity: owner,
        entityType: "project",
        entityId: "p1",
        workspaceId: "w1",
      },
      ["actor-1"],
      executor as never,
    );
    expect(queries[0]?.sql).toContain('"project"."deleted_at" is null');
    expect(queries[0]?.sql).toContain('"audit_log"."workspace_id" =');
    expect(queries[0]?.sql).toContain('from "membership"');
    expect(queries[0]?.sql).toContain('"audit_log"."actor_id" = "user"."id"');
  });

  it("keeps project-label history inside the current project workspace in both SELECTs", async () => {
    const { executor, queries } = captureQueries();
    const input = {
      identity: owner,
      entityType: "project_label" as const,
      entityId: "label-1",
      projectId: "project-1",
      workspaceId: "workspace-b",
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor-1"], executor as never);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('"audit_log"."workspace_id" =');
      expect(query.params).toContain("workspace-b");
    }
  });

  it.each(["automation", "time_activity", "cost_type", "hourly_rate"] as const)(
    "rechecks current workspace %s row, reach and action in both SELECTs",
    async (entityType) => {
      const { executor, queries } = captureQueries();
      const input = {
        identity: serviceKey,
        entityType,
        entityId: "target-1",
        workspaceId: "w1",
        projectId: null,
      };
      await listSettingsHistoryRows(input, executor as never);
      await listSettingsHistoryActorNames(
        input,
        ["actor-1"],
        executor as never,
      );
      expect(queries).toHaveLength(2);
      for (const query of queries) {
        expect(query.sql).toContain(`from "${entityType}"`);
        expect(query.sql).toContain('from "workspace"');
        expect(query.sql).toContain('"audit_log"."project_id" is null');
        expect(query.sql).toContain('"apikey"."enabled" =');
        expect(query.sql).toContain('"api_key"."disabled_at" is null');
        expect(query.sql).toContain('"audit_log"."action" in');
        expect(query.params).toContain("target-1");
        expect(query.params).toContain("key-1");
      }
      if (entityType === "automation" || entityType === "hourly_rate")
        expect(queries[0]?.sql).toContain(
          `"${entityType}"."project_id" is null`,
        );
    },
  );

  it.each(["automation", "state", "hourly_rate", "budget"] as const)(
    "rechecks current project %s row and exact moved-workspace binding for rows and names",
    async (entityType) => {
      const { executor, queries } = captureQueries();
      const input = {
        identity: owner,
        entityType,
        entityId: "target-1",
        workspaceId: "new-w",
        projectId: "p1",
      };
      await listSettingsHistoryRows(input, executor as never);
      await listSettingsHistoryActorNames(
        input,
        ["actor-1"],
        executor as never,
      );
      expect(queries).toHaveLength(2);
      for (const query of queries) {
        expect(query.sql).toContain('from "project"');
        expect(query.sql).toContain('"project"."deleted_at" is null');
        expect(query.sql).toContain(`from "${entityType}"`);
        expect(query.sql).toContain('"audit_log"."workspace_id" =');
        expect(query.sql).toContain('"audit_log"."project_id" =');
        expect(query.sql).toContain('"audit_log"."action" in');
        expect(query.params).toContain("new-w");
        expect(query.params).toContain("p1");
      }
    },
  );

  it("never treats a project automation as a workspace rule", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "automation",
        entityId: "a1",
        workspaceId: "w1",
        projectId: undefined,
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain("false");
  });

  it("narrows only the instance selector to settings changes in rows and actor names, keeping its scope", async () => {
    const { executor, queries } = captureQueries();
    const input = {
      identity: owner,
      entityType: "instance" as const,
      entityId: "singleton",
      workspaceId: null,
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor-1"], executor as never);
    // A global terminology selector keeps its own action and is not widened or narrowed here.
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "terminology_override" as const,
        entityId: "instance",
        workspaceId: null,
      },
      executor as never,
    );
    expect(queries).toHaveLength(3);
    for (const query of queries.slice(0, 2)) {
      expect(query.sql).toContain('from "instance_setting"');
      expect(query.sql).toContain('"audit_log"."action" =');
      expect(query.sql).toContain('"audit_log"."workspace_id" is null');
      expect(query.sql).toContain('"audit_log"."project_id" is null');
      expect(query.params).toContain("instance");
      expect(query.params).toContain("singleton");
      expect(query.params).toContain("instance.settings_changed");
    }
    expect(queries[2]?.params).not.toContain("instance.settings_changed");
    expect(queries[2]?.params).toContain("terminology.changed");
  });
});
