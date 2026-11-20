import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../../apps/api/src/audit/repository";
import { settingsHistoryResponseSchema } from "../../../apps/api/src/audit/response";
import { settingsHistoryQuery } from "../../../apps/api/src/audit/schema";
import {
  selectSettingsHistoryPolicy,
  settingsHistoryPolicyVariants,
} from "../../../apps/api/src/policy-registry";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

function captureQueries() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const executor = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { queries, executor };
}

describe("P5 service key settings history", () => {
  it("has one validated session-only policy and a closed response type", () => {
    expect(settingsHistoryQuery.shape.entity_type.options).toContain(
      "service_api_key",
    );
    expect(
      settingsHistoryPolicyVariants.filter(
        (v) => v.entityType === "service_api_key",
      ),
    ).toHaveLength(1);
    expect(
      selectSettingsHistoryPolicy("service_api_key")?.policy,
    ).toMatchObject({
      capability: "api_key:manage",
      scope: "workspace",
      scopeSource: "row",
      reach: "required",
      sessionOnly: true,
    });
    expect(
      settingsHistoryResponseSchema.shape.entityType.safeParse(
        "service_api_key",
      ).success,
    ).toBe(true);
  });

  it("rechecks session, live service-key row, workspace reach and manage capability for both data and actor names", async () => {
    const { queries, executor } = captureQueries();
    const input = {
      identity: identityFor("owner"),
      entityType: "service_api_key" as const,
      entityId: "key-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      projectId: null,
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor-1"], executor as never);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('from "session"');
      expect(query.sql).toContain('from "apikey"');
      expect(query.sql).toContain('"api_key"');
      expect(query.sql).toContain('from "workspace"');
      expect(query.sql).toContain('"audit_log"."workspace_id" =');
      expect(query.sql).toContain('"audit_log"."project_id" is null');
      expect(query.sql).toContain('"audit_log"."entity_type" =');
      expect(query.params).toEqual(
        expect.arrayContaining([
          "key-1",
          "workspace-1",
          "session-1",
          "api_key:manage",
        ]),
      );
      for (const action of [
        "api_key.created",
        "api_key.revoked",
        "api_key.reattested",
        "api_key.ownership_transferred",
      ])
        expect(query.params).toContain(action);
    }
  });

  it("fails closed when the key is not a session or no trusted session target was resolved", async () => {
    const { queries, executor } = captureQueries();
    await listSettingsHistoryRows(
      {
        identity: identityFor("owner"),
        entityType: "service_api_key",
        entityId: "key-1",
        workspaceId: "workspace-1",
        projectId: null,
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain("false");
  });
});
