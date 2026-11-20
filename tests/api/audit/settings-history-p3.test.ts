import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../../apps/api/src/audit/repository";
import { settingsHistoryResponseSchema } from "../../../apps/api/src/audit/response";
import { settingsHistoryQuery } from "../../../apps/api/src/audit/schema";
import { entityHistoryRow } from "../../../apps/api/src/audit/settings-history";
import { selectSettingsHistoryPolicy } from "../../../apps/api/src/policy-registry";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

const targets = [
  [
    "instance_notification_provider",
    "instance:manage_plugins",
    "instance_plugin_config",
  ],
  ["instance_storage_draft", "instance:admin", "instance_plugin_config"],
  ["instance_auth_methods", "instance:admin", null],
  ["staff_self_registration", "instance:admin", "instance_setting"],
  ["instance_job", "instance:manage_jobs", "instance_job_configuration"],
  ["identity_connection", "instance:admin", "identity_connection"],
  ["import_source_connection", "instance:admin", "import_source_connection"],
] as const;

function captureQueries() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const executor = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { queries, executor };
}

describe("P3 closed instance settings history", () => {
  it("registers exactly the seven approved session-only targets", () => {
    for (const [type, capability] of targets) {
      expect(settingsHistoryQuery.shape.entity_type.options).toContain(type);
      expect(selectSettingsHistoryPolicy(type)?.policy).toMatchObject({
        capability,
        scope: "instance",
        sessionOnly: true,
      });
    }
    expect(selectSettingsHistoryPolicy("unknown")).toBeUndefined();
  });

  it.each(targets)(
    "rechecks %s live target and admin authority in both queries",
    async (type, _capability, table) => {
      const { queries, executor } = captureQueries();
      const input = {
        identity: identityFor("instance_admin"),
        entityType: type,
        entityId:
          type === "instance_auth_methods" ? "auth.local-methods" : "target-1",
        sessionId: "session-1",
        workspaceId: type === "import_source_connection" ? "workspace-1" : null,
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
        expect(query.sql).toContain('from "user"');
        expect(query.sql).toContain('inner join "person"');
        expect(query.sql).toContain('from "session"');
        expect(query.sql).toContain('"audit_log"."entity_id" =');
        expect(query.sql).toContain('"audit_log"."project_id" is null');
        if (table) expect(query.sql).toContain(`from "${table}"`);
        if (type === "import_source_connection") {
          expect(query.sql).toContain('from "workspace"');
          expect(query.sql).toContain('"audit_log"."workspace_id" =');
          expect(query.sql).toContain("?|");
          expect(
            query.params.flatMap((param) =>
              Array.isArray(param) ? param : [param],
            ),
          ).toContain("work_item:read");
          expect(query.params).toContain("workspace-1");
        } else
          expect(query.sql).toContain('"audit_log"."workspace_id" is null');
      }
    },
  );

  it("projects only verified closed keys and never raw values", () => {
    const providerRow = {
      createdAt: new Date("2026-11-17T00:00:00Z"),
      actorType: "person",
      action: "plugin.changed",
      entityType: "instance_plugin_config",
      after: {
        pluginId: "notify.email",
        changedKeys: [
          "enabled",
          "config",
          "password",
          "config",
          "host",
          null,
          { secret: "private" },
        ],
        host: "private.example",
        secret: "never return",
      },
    };
    const projectedProvider = entityHistoryRow(
      providerRow,
      "Admin",
      "instance_notification_provider",
    );
    expect(projectedProvider.changedFields).toEqual([
      "configuration",
      "credential",
    ]);
    expect(JSON.stringify(projectedProvider)).not.toContain("private");
    expect(entityHistoryRow(providerRow, "Admin").changedFields).toEqual([]);
    expect(
      entityHistoryRow(providerRow, "Admin", "instance_storage_draft")
        .changedFields,
    ).toEqual([]);
    expect(
      entityHistoryRow(
        { ...providerRow, entityType: "import_source_connection" },
        "Admin",
        "instance_notification_provider",
      ).changedFields,
    ).toEqual([]);
    expect(
      entityHistoryRow(
        { ...providerRow, after: { ...providerRow.after, pluginId: "other" } },
        "Admin",
        "instance_notification_provider",
      ).changedFields,
    ).toEqual([]);
    for (const changedKeys of ["config", ["enabled"], ["unknown"]])
      expect(
        entityHistoryRow(
          { ...providerRow, after: { ...providerRow.after, changedKeys } },
          "Admin",
          "instance_notification_provider",
        ).changedFields,
      ).toEqual([]);
    expect(
      entityHistoryRow(
        {
          createdAt: new Date("2026-11-17T00:00:00Z"),
          actorType: "person",
          action: "plugin.changed",
          entityType: "instance_plugin_config",
          entityId: "auth.local-methods",
          after: {
            changedKeys: [
              "agent.password",
              "customer.magicLink",
              "agent.private",
              "config",
              "agent.password",
            ],
            secret: "never return",
          },
        },
        "Admin",
      ).changedFields,
    ).toEqual(["agent.password", "customer.magicLink"]);
    for (const [before, after, fields] of [
      [{ enabled: false }, { enabled: true }, ["enabled"]],
      [{ enabled: true }, { enabled: true }, []],
      [{ enabled: "false" }, { enabled: true }, []],
    ] as const)
      expect(
        entityHistoryRow(
          {
            createdAt: new Date("2026-11-17T00:00:00Z"),
            actorType: "person",
            action: "plugin.changed",
            entityType: "instance_setting",
            entityId: "staff_self_registration_enabled",
            before,
            after,
          },
          "Admin",
        ).changedFields,
      ).toEqual(fields);
    expect(
      entityHistoryRow(
        {
          createdAt: new Date("2026-11-17T00:00:00Z"),
          actorType: "person",
          action: "job.configuration_changed",
          before: { pattern: "old-cron", enabled: true },
          after: { pattern: "new-cron", enabled: true },
        },
        "Admin",
      ).changedFields,
    ).toEqual(["pattern"]);
    expect(
      entityHistoryRow(
        {
          createdAt: new Date("2026-11-17T00:00:00Z"),
          actorType: "person",
          action: "job.configuration_changed",
          before: { pattern: "same", enabled: true },
          after: { pattern: "same", enabled: true, version: 2 },
        },
        "Admin",
      ).changedFields,
    ).toEqual([]);
    expect(
      settingsHistoryResponseSchema.safeParse({
        entityType: "instance_job",
        entityId: "job-1",
        workspaceId: null,
        projectId: null,
        lastChanged: null,
        rows: [],
      }).success,
    ).toBe(true);
  });

  it("fails closed in SQL when a P3 request lacks its trusted session or workspace scope", async () => {
    const { executor, queries } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: identityFor("instance_admin"),
        entityType: "instance_job",
        entityId: "job-1",
        workspaceId: null,
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      {
        identity: identityFor("instance_admin"),
        entityType: "import_source_connection",
        entityId: "source-1",
        sessionId: "session-1",
        workspaceId: null,
      },
      executor as never,
    );
    expect(queries).toHaveLength(2);
    for (const query of queries) expect(query.sql).toContain("false");
  });
});
