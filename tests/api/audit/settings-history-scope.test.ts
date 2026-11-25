import { PgDialect } from "drizzle-orm/pg-core";
import type { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import {
  identityFor,
  ORGANISATION_ID,
  PROJECT_ID,
  WORKSPACE_ID,
} from "../../../tests/permissions/matrix-fixture";

const select = vi.hoisted(() => vi.fn());
const resolveRequestIdentity = vi.hoisted(() => vi.fn());
const trackingFeatureEnabled = vi.hoisted(() => vi.fn(async () => true));
const trackingFeatureReachable = vi.hoisted(() => vi.fn(async () => true));
const agileFeatureEnabled = vi.hoisted(() => vi.fn(async () => true));
const requireCurrentInstanceAdmin = vi.hoisted(() => vi.fn(async () => {}));
const assertCallerHasCapability = vi.hoisted(() => vi.fn(async () => {}));
let targetCondition: Parameters<PgDialect["sqlToQuery"]>[0] | undefined;
vi.mock("../../../apps/api/src/database", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../apps/api/src/database")>();
  return { ...actual, default: { select } };
});
vi.mock("../../../apps/api/src/permissions/resolve-request-identity", () => ({
  resolveRequestIdentity,
}));
vi.mock("../../../apps/api/src/time-tracking/feature", () => ({
  trackingFeatureEnabled,
  trackingFeatureReachable,
  TIME_TRACKING_FEATURE_KEY: "feature.time_tracking",
  COST_TRACKING_FEATURE_KEY: "feature.cost_tracking",
}));
vi.mock("../../../apps/api/src/agile/feature", () => ({ agileFeatureEnabled }));
vi.mock("../../../apps/api/src/instance/require-instance-admin", () => ({
  requireCurrentInstanceAdmin,
}));
vi.mock(
  "../../../apps/api/src/utils/require-workspace-capability",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../apps/api/src/utils/require-workspace-capability")
    >()),
    assertCallerHasCapability,
  }),
);
vi.mock("../../../apps/api/src/project/hierarchy.repository", () => ({
  loadProjectAncestorIdsFor: vi.fn(async () => []),
  loadProjectOwnerTeamIdFor: vi.fn(async () => null),
}));

import { settingsHistoryScope } from "../../../apps/api/src/audit/settings-history";

function context(entityType: string, entityId: string, extra = "") {
  const values = new Map<string, unknown>([
    ["userId", "user-owner"],
    ["session", { id: "session-1", portal: "agent" }],
  ]);
  return {
    req: {
      url: `http://localhost:1337/api/audit?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}${extra}`,
      query: (name: string) =>
        new URL(
          `http://localhost:1337/api/audit?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}${extra}`,
        ).searchParams.get(name) ?? undefined,
      header: (name: string) =>
        name === "host"
          ? (values.get("host") as string | undefined)
          : undefined,
    },
    get: (name: string) => values.get(name),
    set: (name: string, value: unknown) => values.set(name, value),
  };
}

function workspaceLookup(rows: Array<{ workspaceId: string }>) {
  targetCondition = undefined;
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    where: (condition: typeof targetCondition) => {
      targetCondition = condition;
      return builder;
    },
    limit: async () => rows,
  };
  select.mockReturnValue(builder);
  return builder;
}

describe("settings history target scope", () => {
  it("resolves only a live service-key row for the current agent session and key manager", async () => {
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    assertCallerHasCapability.mockClear();
    workspaceLookup([{ workspaceId: WORKSPACE_ID, id: WORKSPACE_ID } as never]);
    const service = context("service_api_key", "key-1");
    await settingsHistoryScope(service as never, vi.fn());
    expect(service.get("settingsHistoryScope")).toEqual({
      type: "service_api_key",
      id: "key-1",
      workspaceId: WORKSPACE_ID,
      projectId: null,
      sessionId: "session-1",
    });
    expect(assertCallerHasCapability).toHaveBeenCalledWith(
      WORKSPACE_ID,
      "user-owner",
      "api_key:manage",
      { kind: "session" },
    );
    expect(service.get("workspaceIdSource")).toBe("row");
    workspaceLookup([]);
    await expect(
      settingsHistoryScope(
        context("service_api_key", "deleted-key") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects service-key query scope spoofing and wrong credential, side or host", async () => {
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    await expect(
      settingsHistoryScope(
        context("service_api_key", "key-1", "&workspace_id=other") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    for (const denied of [
      { apiKey: { id: "key-2", service: true } },
      { session: { id: "session-1", portal: "customer" } },
      {
        session: {
          id: "session-1",
          portal: "agent",
          impersonatedBy: "admin-2",
        },
      },
      { session: null },
      { host: "portal.localhost" },
    ]) {
      const attempted = context("service_api_key", "key-1");
      for (const [key, value] of Object.entries(denied))
        attempted.set(key, value);
      await expect(
        settingsHistoryScope(attempted as never, vi.fn()),
      ).rejects.toMatchObject({ status: 403 });
    }
  });
  it("resolves P4 terminology instance and workspace catalogue cells with source admission", async () => {
    resolveRequestIdentity.mockResolvedValue(identityFor("instance_admin"));
    const instance = context(
      "terminology_override",
      "project:agent:en-US",
      "&scope=instance",
    );
    await settingsHistoryScope(instance as never, vi.fn());
    expect(instance.get("settingsHistoryScope")).toEqual({
      type: "terminology_override",
      id: "project:agent:en-US",
      workspaceId: null,
      projectId: null,
    });
    expect(requireCurrentInstanceAdmin).toHaveBeenCalledWith(
      instance,
      "GET",
      "/api/instance/terminology",
    );
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    workspaceLookup([{ id: WORKSPACE_ID } as never]);
    const workspace = context(
      "terminology_override",
      "project:agent:en-US",
      `&scope=workspace&workspace_id=${WORKSPACE_ID}`,
    );
    await settingsHistoryScope(workspace as never, vi.fn());
    expect(workspace.get("settingsHistoryScope")).toEqual({
      type: "terminology_override",
      id: "project:agent:en-US",
      workspaceId: WORKSPACE_ID,
      projectId: null,
    });
    expect(workspace.get("workspaceIdSource")).toBe("row");
    workspaceLookup([{ id: WORKSPACE_ID } as never]);
    const narrowKey = context(
      "terminology_override",
      "project:agent:en-US",
      `&scope=workspace&workspace_id=${WORKSPACE_ID}`,
    );
    narrowKey.set("apiKey", {
      id: "key-1",
      userId: "user-owner",
      enabled: true,
      permissions: { workspace: ["read"] },
    });
    await expect(
      settingsHistoryScope(narrowKey as never, vi.fn()),
    ).rejects.toMatchObject({ status: 403 });
    for (const extra of [
      "&scope=instance&workspace_id=w1",
      "&scope=workspace&workspace_id=w1&workspace_id=w2",
      "&scope=instance&other=x",
    ]) {
      await expect(
        settingsHistoryScope(
          context(
            "terminology_override",
            "project:agent:en-US",
            extra,
          ) as never,
          vi.fn(),
        ),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("rejects P4 portal, impersonation, absent project and feature-off before reading audit", async () => {
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const portal = context("project_estimates", PROJECT_ID);
    portal.set("host", "portal.localhost");
    await expect(
      settingsHistoryScope(portal as never, vi.fn()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      settingsHistoryScope(
        context("project_estimates", PROJECT_ID, "&scope=instance") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const impersonated = context(
      "terminology_override",
      "project:agent:en-US",
      "&scope=instance",
    );
    impersonated.set("session", {
      id: "session-1",
      portal: "agent",
      impersonatedBy: "other",
    });
    await expect(
      settingsHistoryScope(impersonated as never, vi.fn()),
    ).rejects.toMatchObject({ status: 403 });
    workspaceLookup([]);
    await expect(
      settingsHistoryScope(
        context("project_estimates", PROJECT_ID) as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    workspaceLookup([
      {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organisationId: ORGANISATION_ID,
      } as never,
    ]);
    agileFeatureEnabled.mockResolvedValueOnce(false);
    await expect(
      settingsHistoryScope(
        context("project_estimates", PROJECT_ID) as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("resolves P3 row, logical and workspace targets only for the agent admin session", async () => {
    resolveRequestIdentity.mockResolvedValue(identityFor("instance_admin"));
    workspaceLookup([{ id: "provider-row" } as never]);
    const provider = context("instance_notification_provider", "provider-row");
    await settingsHistoryScope(provider as never, vi.fn());
    expect(provider.get("settingsHistoryScope")).toEqual({
      type: "instance_notification_provider",
      id: "provider-row",
      workspaceId: null,
      projectId: null,
      sessionId: "session-1",
    });
    if (!targetCondition) throw new Error("Missing provider target filter");
    const providerSql = new PgDialect().sqlToQuery(targetCondition).sql;
    expect(providerSql).toContain('"instance_plugin_config"."plugin_id" =');
    expect(providerSql).toContain('"instance_plugin_config"."instance_key" =');

    const methods = context("instance_auth_methods", "auth.local-methods");
    await settingsHistoryScope(methods as never, vi.fn());
    expect(methods.get("settingsHistoryScope")).toMatchObject({
      type: "instance_auth_methods",
      sessionId: "session-1",
    });
    await expect(
      settingsHistoryScope(
        context("instance_auth_methods", "auth.other") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const admin = identityFor("instance_admin");
    resolveRequestIdentity.mockResolvedValue({
      ...admin,
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
      authority: [...admin.authority, ...identityFor("owner").authority],
    });
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    const source = context("import_source_connection", "source-1");
    await settingsHistoryScope(source as never, vi.fn());
    expect(source.get("settingsHistoryScope")).toMatchObject({
      type: "import_source_connection",
      workspaceId: WORKSPACE_ID,
      sessionId: "session-1",
    });
    expect(source.get("workspaceIdSource")).toBe("row");

    resolveRequestIdentity.mockResolvedValue(identityFor("instance_admin"));
    await expect(
      settingsHistoryScope(
        context("import_source_connection", "source-1") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 403 });

    for (const denied of [
      { apiKey: { service: true, id: "key-1" } },
      { session: { id: "session-1", portal: "customer" } },
      {
        session: {
          id: "session-1",
          portal: "agent",
          impersonatedBy: "admin-2",
        },
      },
      { session: null },
      { host: "foreign.example" },
    ]) {
      const attempted = context("instance_auth_methods", "auth.local-methods");
      for (const [key, value] of Object.entries(denied))
        attempted.set(key, value);
      await expect(
        settingsHistoryScope(attempted as never, vi.fn()),
      ).rejects.toMatchObject({ status: 403 });
    }
    workspaceLookup([]);
    await expect(
      settingsHistoryScope(
        context("instance_notification_provider", "removed-row") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("resolves the workspace member row ID to its user audit subject and requires a session", async () => {
    workspaceLookup([{ workspaceId: WORKSPACE_ID, userId: "user-1" } as never]);
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    const c = context("workspace_member", "member-row-1");
    await settingsHistoryScope(c as never, vi.fn());
    expect(c.get("settingsHistoryScope")).toEqual({
      type: "workspace_member",
      id: "member-row-1",
      workspaceId: WORKSPACE_ID,
      projectId: null,
      auditEntityId: "user-1",
    });
    if (!targetCondition) throw new Error("Missing target filter");
    expect(new PgDialect().sqlToQuery(targetCondition).sql).toContain(
      '"workspace_member"."id" =',
    );
    for (const denied of [
      { apiKey: { service: true, id: "key-1" } },
      { session: { impersonatedBy: "other" } },
    ]) {
      const attempted = context("workspace_member", "member-row-1");
      for (const [key, value] of Object.entries(denied))
        attempted.set(key, value);
      await expect(
        settingsHistoryScope(attempted as never, vi.fn()),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("resolves only a currently backed direct project membership row", async () => {
    const targetBuilder = workspaceLookup([
      { personId: "person-1", projectId: PROJECT_ID } as never,
    ]);
    let grantCondition: typeof targetCondition;
    const grantBuilder = {
      from: () => grantBuilder,
      where: (condition: typeof targetCondition) => {
        grantCondition = condition;
        return grantBuilder;
      },
    };
    const projectBuilder = {
      from: () => projectBuilder,
      innerJoin: () => projectBuilder,
      where: () => projectBuilder,
      limit: async () => [
        {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organisationId: ORGANISATION_ID,
        },
      ],
    };
    select.mockReset();
    select
      .mockReturnValueOnce(targetBuilder)
      .mockReturnValueOnce(grantBuilder)
      .mockReturnValueOnce(projectBuilder);
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const c = context("project_membership", "membership-1");
    await settingsHistoryScope(c as never, vi.fn());
    expect(c.get("settingsHistoryScope")).toEqual({
      type: "project_membership",
      id: "membership-1",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      auditEntityId: "person-1",
    });
    if (!targetCondition) throw new Error("Missing target filter");
    if (!grantCondition) throw new Error("Missing grant filter");
    const sql = new PgDialect().sqlToQuery(grantCondition).sql;
    expect(sql).toContain(
      '"membership_grant"."membership_id" = "membership"."id"',
    );
    expect(sql).toContain('"membership_grant"."source_kind" =');
    expect(sql).toContain('"membership_grant"."revoked_at" is null');

    workspaceLookup([]);
    await expect(
      settingsHistoryScope(
        context("project_membership", "removed") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects an absent persisted target before reading its audit rows", async () => {
    workspaceLookup([]);
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const next = vi.fn();
    await expect(
      settingsHistoryScope(context("workspace", "missing") as never, next),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<HTTPException>);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not reveal a workspace target outside the caller's reach", async () => {
    workspaceLookup([{ workspaceId: "other-workspace" }]);
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    const next = vi.fn();
    await expect(
      settingsHistoryScope(
        context("workspace", "other-workspace") as never,
        next,
      ),
    ).rejects.toMatchObject({ status: 404 } satisfies Partial<HTTPException>);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes a reached target with its row-derived scope", async () => {
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    const c = context("workspace", WORKSPACE_ID);
    const next = vi.fn();
    await settingsHistoryScope(c as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(c.get("workspaceId")).toBe(WORKSPACE_ID);
    expect(c.get("workspaceIdSource")).toBe("row");
  });

  it("accepts only a catalogue label row, never a task assignment", async () => {
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    await settingsHistoryScope(
      context("workspace_label", "label-1") as never,
      vi.fn(),
    );
    if (!targetCondition) throw new Error("Missing target filter");
    const sql = new PgDialect().sqlToQuery(targetCondition).sql;
    expect(sql).toContain('"label"."project_id" is null');
    expect(sql).toContain('"label"."task_id" is null');
  });

  it("resolves workspace automation from its row without inventing project reach", async () => {
    workspaceLookup([{ workspaceId: WORKSPACE_ID, projectId: null } as never]);
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    const c = context("automation", "rule-1");
    await settingsHistoryScope(c as never, vi.fn());
    expect(c.get("settingsHistoryScope")).toEqual({
      type: "automation",
      id: "rule-1",
      workspaceId: WORKSPACE_ID,
      projectId: null,
    });
    expect(c.get("projectId")).toBeUndefined();
  });

  it("scopes the workspace feature-switch selector: allowed, missing capability, foreign tenant, missing target", async () => {
    const staff = (key: "owner" | "viewer") => ({
      ...identityFor(key),
      memberships: [{ scope: "workspace" as const, scopeId: WORKSPACE_ID }],
    });
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    resolveRequestIdentity.mockResolvedValue(staff("owner"));
    const c = context("workspace_features", WORKSPACE_ID);
    const next = vi.fn();
    await settingsHistoryScope(c as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(c.get("settingsHistoryScope")).toEqual({
      type: "workspace_features",
      id: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
    });
    resolveRequestIdentity.mockResolvedValue(staff("viewer"));
    await expect(
      settingsHistoryScope(
        context("workspace_features", WORKSPACE_ID) as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    resolveRequestIdentity.mockResolvedValue(staff("owner"));
    workspaceLookup([{ workspaceId: "other-workspace" }]);
    await expect(
      settingsHistoryScope(
        context("workspace_features", "other-workspace") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    workspaceLookup([]);
    await expect(
      settingsHistoryScope(
        context("workspace_features", "missing") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("scopes the project feature-switch selector: allowed, missing capability, foreign tenant, missing target", async () => {
    const lookup = (rows: unknown[]) => {
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        limit: async () => rows,
      };
      select.mockReset();
      select.mockReturnValue(builder);
    };
    const live = [
      {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        organisationId: ORGANISATION_ID,
      },
    ];
    lookup(live);
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const c = context("project_features", PROJECT_ID);
    const next = vi.fn();
    await settingsHistoryScope(c as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(c.get("settingsHistoryScope")).toEqual({
      type: "project_features",
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
    });
    expect(c.get("policyScopeResource")).toBe("project");
    resolveRequestIdentity.mockResolvedValue(identityFor("viewer"));
    await expect(
      settingsHistoryScope(
        context("project_features", PROJECT_ID) as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    resolveRequestIdentity.mockResolvedValue(
      identityFor("owner", { inReach: false }),
    );
    await expect(
      settingsHistoryScope(
        context("project_features", PROJECT_ID) as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    lookup([]);
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    await expect(
      settingsHistoryScope(
        context("project_features", "missing") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("binds project automation to the live project and rejects a removed project", async () => {
    const target = { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID };
    const targetBuilder = workspaceLookup([target]);
    const projectRows = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          organisationId: ORGANISATION_ID,
        },
      ])
      .mockResolvedValueOnce([]);
    const projectBuilder = {
      from: () => projectBuilder,
      innerJoin: () => projectBuilder,
      where: () => projectBuilder,
      limit: projectRows,
    };
    select.mockReset();
    select
      .mockReturnValueOnce(targetBuilder)
      .mockReturnValueOnce(projectBuilder);
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const c = context("automation", "rule-1");
    await settingsHistoryScope(c as never, vi.fn());
    expect(c.get("projectId")).toBe(PROJECT_ID);
    expect(c.get("policyScopeResource")).toBe("project");

    select
      .mockReturnValueOnce(targetBuilder)
      .mockReturnValueOnce(projectBuilder);
    await expect(
      settingsHistoryScope(context("automation", "rule-1") as never, vi.fn()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("applies source feature gates to activity and cost history", async () => {
    resolveRequestIdentity.mockResolvedValue({
      ...identityFor("owner"),
      memberships: [{ scope: "workspace", scopeId: WORKSPACE_ID }],
    });
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    trackingFeatureReachable.mockResolvedValueOnce(false);
    await expect(
      settingsHistoryScope(
        context("time_activity", "activity-1") as never,
        vi.fn(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    workspaceLookup([{ workspaceId: WORKSPACE_ID }]);
    trackingFeatureEnabled.mockResolvedValueOnce(false);
    await expect(
      settingsHistoryScope(context("cost_type", "cost-1") as never, vi.fn()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(["state", "budget", "hourly_rate"] as const)(
    "resolves %s through the live project before read",
    async (type) => {
      const targetBuilder = workspaceLookup([
        {
          workspaceId: type === "state" ? null : WORKSPACE_ID,
          projectId: PROJECT_ID,
        },
      ] as never);
      const projectBuilder = {
        from: () => projectBuilder,
        innerJoin: () => projectBuilder,
        where: () => projectBuilder,
        limit: async () => [
          {
            id: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            organisationId: ORGANISATION_ID,
          },
        ],
      };
      select.mockReset();
      select
        .mockReturnValueOnce(targetBuilder)
        .mockReturnValueOnce(projectBuilder);
      resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
      const c = context(type, "target-1");
      await settingsHistoryScope(c as never, vi.fn());
      expect(c.get("settingsHistoryScope")).toEqual({
        type,
        id: "target-1",
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
      });
      expect(c.get("policyScopeResource")).toBe("project");
    },
  );

  it("keeps budget history closed to service keys like the source GET", async () => {
    resolveRequestIdentity.mockResolvedValue(identityFor("owner"));
    const c = context("budget", "target-1");
    c.set("apiKey", { service: true, id: "service-key" });
    await expect(
      settingsHistoryScope(c as never, vi.fn()),
    ).rejects.toMatchObject({ status: 403 });
  });
});
