import { drizzle } from "drizzle-orm/pg-proxy";
import { describe, expect, it } from "vitest";
import { HISTORY_RESPONSE_TYPES } from "../../../apps/api/src/audit/history-actions";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../../apps/api/src/audit/repository";
import {
  parseTerminologyHistoryScope,
  settingsHistoryQuery,
} from "../../../apps/api/src/audit/schema";
import { entityHistoryRow } from "../../../apps/api/src/audit/settings-history";
import {
  selectSettingsHistoryPolicy,
  settingsHistoryPolicyVariants,
} from "../../../apps/api/src/policy-registry";
import {
  terminologyLocaleSchema,
  terminologyTermKeySchema,
} from "../../../apps/api/src/terminology/schema";
import { identityFor } from "../../../tests/permissions/matrix-fixture";

const owner = identityFor("owner");

function capture() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const executor = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  });
  return { queries, executor };
}

describe("P4 closed settings history", () => {
  it("validates exact terminology cells and explicit scope with no ignored parameters", () => {
    expect(settingsHistoryQuery.shape.entity_type.options).toContain(
      "terminology_override",
    );
    const parse = (query: string) =>
      parseTerminologyHistoryScope(
        new URLSearchParams(query),
        "project:agent:en-US",
      );
    expect(
      parse(
        "entity_type=terminology_override&entity_id=project%3Aagent%3Aen-US&scope=instance",
      ),
    ).toEqual({ scope: "instance", workspaceId: null });
    expect(
      parse(
        "entity_type=terminology_override&entity_id=project%3Aagent%3Aen-US&scope=workspace&workspace_id=w1",
      ),
    ).toEqual({ scope: "workspace", workspaceId: "w1" });
    for (const termKey of terminologyTermKeySchema.options)
      for (const audience of ["agent", "customer", "both"])
        for (const locale of terminologyLocaleSchema.options)
          expect(
            parseTerminologyHistoryScope(
              new URLSearchParams("scope=instance"),
              `${termKey}:${audience}:${locale}`,
            ),
          ).toEqual({ scope: "instance", workspaceId: null });
    for (const query of [
      "scope=instance&workspace_id=w1",
      "scope=workspace",
      "scope=workspace&workspace_id=w1&workspace_id=w2",
      "scope=instance&scope=workspace",
      "scope=instance&foo=bar",
    ])
      expect(parse(query)).toBeNull();
    for (const cell of [
      "project:agent:EN",
      "project:agent:en:extra",
      "bogus:agent:en",
      "project:bogus:en",
      "project::en",
    ])
      expect(
        parseTerminologyHistoryScope(
          new URLSearchParams("scope=instance"),
          cell,
        ),
      ).toBeNull();
  });

  it("selects only trusted terminology variant and estimate read policy", () => {
    expect(settingsHistoryPolicyVariants).toHaveLength(38);
    expect(
      settingsHistoryPolicyVariants
        .filter((variant) => variant.entityType === "terminology_override")
        .map((variant) => variant.variantLabel)
        .sort(),
    ).toEqual([
      "terminology_override:instance",
      "terminology_override:workspace",
    ]);
    expect(
      selectSettingsHistoryPolicy("project_estimates")?.policy,
    ).toMatchObject({ capability: "project:read", scope: "project" });
    expect(selectSettingsHistoryPolicy("terminology_override")).toBeUndefined();
    expect(
      selectSettingsHistoryPolicy(
        "terminology_override",
        "project:agent:en-US",
        {
          type: "terminology_override",
          id: "project:agent:en-US",
          workspaceId: null,
          projectId: null,
        },
        {},
      )?.policy,
    ).toMatchObject({
      capability: "instance:manage_terminology",
      scope: "instance",
    });
    expect(
      selectSettingsHistoryPolicy(
        "terminology_override",
        "project:agent:en-US",
        {
          type: "terminology_override",
          id: "project:agent:en-US",
          workspaceId: "w1",
          projectId: null,
        },
        { workspaceId: "w1", workspaceIdSource: "row" },
      )?.policy,
    ).toMatchObject({
      capability: "workspace:manage_settings",
      scope: "workspace",
    });
    expect(
      selectSettingsHistoryPolicy(
        "terminology_override",
        "project:agent:en-US",
        {
          type: "terminology_override",
          id: "project:agent:en-US",
          workspaceId: "w1",
        },
        { workspaceId: "w2", workspaceIdSource: "row" },
      ),
    ).toBeUndefined();
    expect(
      selectSettingsHistoryPolicy(
        "terminology_override",
        "project:agent:en-US",
        {
          type: "terminology_override",
          id: "project:agent:en-US",
          workspaceId: null,
          projectId: null,
        },
        { resource: "project" },
      ),
    ).toBeUndefined();
  });

  it("uses exact scoped terminology actions and rechecks authority for rows and actor names", async () => {
    const { queries, executor } = capture();
    const input = {
      identity: owner,
      entityType: "terminology_override" as const,
      entityId: "project:agent:en-US",
      workspaceId: "w1",
      projectId: null,
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor"], executor as never);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.params).toContain("terminology.changed");
      expect(query.params).toContain("terminology_override");
      expect(query.params).toContain("project:agent:en-US");
      expect(query.sql).toContain('"audit_log"."project_id" is null');
      expect(query.sql).toContain('"audit_log"."workspace_id" =');
      expect(query.sql).toContain('from "workspace"');
    }
  });

  it("keeps instance terminology inside null workspace and project scope", async () => {
    const { queries, executor } = capture();
    await listSettingsHistoryRows(
      {
        identity: identityFor("instance_admin"),
        entityType: "terminology_override",
        entityId: "project:agent:en-US",
        workspaceId: null,
        projectId: null,
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain('"audit_log"."workspace_id" is null');
    expect(queries[0]?.sql).toContain('"audit_log"."project_id" is null');
    expect(queries[0]?.sql).toContain('"user"."role" =');
  });

  it("rechecks a P4 personal key's current row and refuses absent key proof", async () => {
    const { queries, executor } = capture();
    const identity = {
      ...owner,
      credential: "api_key" as const,
      keyCapabilities: ["workspace:manage_settings" as const],
    };
    const input = {
      identity,
      entityType: "terminology_override" as const,
      entityId: "project:agent:en-US",
      workspaceId: "w1",
      projectId: null,
    };
    await listSettingsHistoryRows(
      { ...input, apiKeyId: "key-1" },
      executor as never,
    );
    expect(queries[0]?.sql).toContain('from "apikey"');
    expect(queries[0]?.sql).toContain('"apikey"."enabled" =');
    expect(queries[0]?.sql).toContain('"apikey"."expires_at"');
    expect(queries[0]?.params).toContain("key-1");
    await listSettingsHistoryRows(input, executor as never);
    expect(queries[1]?.sql).toContain("false");
  });

  it("binds estimate history to project and workspace across replaced rows with current feature gate", async () => {
    const { queries, executor } = capture();
    const input = {
      identity: owner,
      entityType: "project_estimates" as const,
      entityId: "p1",
      workspaceId: "w1",
      projectId: "p1",
    };
    await listSettingsHistoryRows(input, executor as never);
    await listSettingsHistoryActorNames(input, ["actor"], executor as never);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.params).toEqual(
        expect.arrayContaining([
          "estimate",
          "estimate.configured",
          "estimate.system_changed",
          "p1",
          "w1",
        ]),
      );
      expect(query.sql).toContain("feature.estimates");
      expect(query.sql).toContain('from "project_feature_flag"');
      expect(query.sql).toContain('from "workspace_feature_flag"');
      expect(query.sql).toContain('from "instance_feature_flag"');
      expect(query.sql).toContain('"instance_feature_flag"."locked" =');
      expect(query.sql).toContain('"audit_log"."project_id" =');
      expect(query.sql).toContain('"audit_log"."workspace_id" =');
      expect(query.sql).not.toContain('"audit_log"."entity_id" =');
      expect(query.sql).toContain('from "project"');
    }
  });

  it("refuses mismatched project IDs without widening to an unrelated estimate trail", async () => {
    const { queries, executor } = capture();
    await listSettingsHistoryRows(
      {
        identity: owner,
        entityType: "project_estimates",
        entityId: "p1",
        workspaceId: "w1",
        projectId: "p2",
      },
      executor as never,
    );
    expect(queries[0]?.sql).toContain("false");
  });

  it("does not project customer terms or estimate values", () => {
    for (const action of [
      "terminology.changed",
      "estimate.configured",
      "estimate.system_changed",
    ]) {
      const row = entityHistoryRow(
        {
          createdAt: new Date(0),
          actorType: "person",
          action,
          before: { forms: { one: "private" }, points: 5 },
          after: {
            forms: { one: "private2" },
            points: 8,
            changedFields: ["forms", "points"],
          },
        },
        "actor",
      );
      expect(row.changedFields).toEqual([]);
      expect(JSON.stringify(row)).not.toContain("private");
    }
  });

  it("reads feature-switch history from its own types, never the General workspace or project ones", async () => {
    const { queries, executor } = capture();
    const base = { identity: owner, workspaceId: "w1" };
    await listSettingsHistoryRows(
      {
        ...base,
        entityType: "workspace_features",
        entityId: "w1",
        projectId: null,
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      {
        ...base,
        entityType: "project_features",
        entityId: "p1",
        projectId: "p1",
      },
      executor as never,
    );
    await listSettingsHistoryRows(
      { ...base, entityType: "workspace", entityId: "w1", projectId: null },
      executor as never,
    );
    expect(queries[0]?.params).toContain("feature_flag.changed");
    expect(queries[0]?.params).toContain("workspace");
    expect(queries[1]?.params).toContain("feature_flag.changed");
    expect(queries[1]?.params).toContain("project");
    expect(queries[1]?.sql).toContain('"audit_log"."project_id" =');
    expect(queries[2]?.params).not.toContain("feature_flag.changed");
    // The aliases are selectors only: the response enum keeps reporting the edited row.
    expect(HISTORY_RESPONSE_TYPES).not.toContain("workspace_features");
    expect(HISTORY_RESPONSE_TYPES).not.toContain("project_features");
    expect(HISTORY_RESPONSE_TYPES).toContain("workspace");
  });

  it("projects a feature-switch row to one closed key marker and never echoes the payload", () => {
    const row = (feature: unknown) =>
      entityHistoryRow(
        {
          createdAt: new Date(0),
          actorType: "person",
          action: "feature_flag.changed",
          before: { feature, enabled: null },
          after: { feature, enabled: true, secret: "private" },
        },
        "actor",
      );
    expect(row("feature.estimates").changedFields).toEqual([
      "featureFlag:feature.estimates",
    ]);
    expect(row("not-a-flag").changedFields).toEqual([]);
    expect(JSON.stringify(row("feature.estimates"))).not.toContain("private");
  });
});
