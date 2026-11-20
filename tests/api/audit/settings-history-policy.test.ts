import {
  evaluatePolicy,
  instanceScope,
  projectScopeFromRow,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { settingsHistoryResponseSchema } from "../../../apps/api/src/audit/response";
import { settingsHistoryQuery } from "../../../apps/api/src/audit/schema";
import {
  entityHistoryRow,
  safePreferenceAuditFields,
} from "../../../apps/api/src/audit/settings-history";
import {
  selectSettingsHistoryPolicy,
  settingsHistoryPolicyVariants,
} from "../../../apps/api/src/policy-registry";
import {
  identityFor,
  MATRIX_TARGET,
  PROJECT_ID,
  WORKSPACE_ID,
} from "../../../tests/permissions/matrix-fixture";

describe("settings history policy selection", () => {
  it("uses a closed entity selector with the screen capability", () => {
    expect(settingsHistoryQuery.shape.entity_type.options).toHaveLength(34);
    expect(settingsHistoryPolicyVariants).toHaveLength(36);
    expect(
      [
        ...new Set(
          settingsHistoryPolicyVariants.map((variant) => variant.entityType),
        ),
      ].sort(),
    ).toEqual([...settingsHistoryQuery.shape.entity_type.options].sort());
    for (const variant of settingsHistoryPolicyVariants)
      if (
        variant.entityType !== "automation" &&
        variant.entityType !== "terminology_override"
      )
        expect(selectSettingsHistoryPolicy(variant.entityType)).toBe(
          variant.entry,
        );
    expect(settingsHistoryPolicyVariants).toHaveLength(
      settingsHistoryQuery.shape.entity_type.options.length + 2,
    );
    expect(
      new Set(
        settingsHistoryPolicyVariants.map((variant) => variant.variantLabel),
      ).size,
    ).toBe(settingsHistoryPolicyVariants.length);
    expect(selectSettingsHistoryPolicy("workspace")?.policy).toMatchObject({
      capability: "workspace:manage_settings",
      scope: "workspace",
    });
    expect(selectSettingsHistoryPolicy("project")?.policy).toMatchObject({
      capability: "project:manage_settings",
      scope: "project",
    });
    expect(selectSettingsHistoryPolicy("instance")?.policy).toMatchObject({
      capability: "instance:admin",
      scope: "instance",
    });
    expect(selectSettingsHistoryPolicy("role")?.policy).toMatchObject({
      capability: "workspace:read",
      scope: "workspace",
      sessionOnly: true,
    });
    expect(selectSettingsHistoryPolicy("workflow")?.policy).toMatchObject({
      capability: "workflow:read",
      scope: "workspace",
    });
    expect(selectSettingsHistoryPolicy("team")?.policy).toMatchObject({
      capability: "workspace:read",
      scope: "workspace",
    });
    expect(
      selectSettingsHistoryPolicy("service_calendar")?.policy,
    ).toMatchObject({
      capability: "sla_policy:read",
      scope: "workspace",
    });
    expect(selectSettingsHistoryPolicy("sla_policy")?.policy).toMatchObject({
      capability: "sla_policy:read",
      scope: "workspace",
    });
    expect(selectSettingsHistoryPolicy("request_type")?.policy).toMatchObject({
      capability: "request_type:read",
      scope: "workspace",
    });
    for (const type of ["custom_field", "custom_field_section"] as const)
      expect(selectSettingsHistoryPolicy(type)?.policy).toMatchObject({
        capability: "workspace:read",
        scope: "workspace",
      });
    expect(selectSettingsHistoryPolicy("state_template")?.policy).toMatchObject(
      {
        capability: "workspace:manage_settings",
        scope: "workspace",
        sessionOnly: true,
      },
    );
    expect(selectSettingsHistoryPolicy("webhook")?.policy).toMatchObject({
      capability: "webhook:manage",
      scope: "workspace",
      elevated: false,
    });
    expect(
      selectSettingsHistoryPolicy("canned_response")?.policy,
    ).toMatchObject({
      capability: "workspace:manage_settings",
      scope: "workspace",
    });
    expect(
      selectSettingsHistoryPolicy("workspace_label")?.policy,
    ).toMatchObject({
      capability: "workspace:read",
      scope: "workspace",
    });
    expect(selectSettingsHistoryPolicy("project_label")?.policy).toMatchObject({
      capability: "workspace:read",
      scope: "project",
    });
    expect(
      selectSettingsHistoryPolicy("workspace_member")?.policy,
    ).toMatchObject({
      capability: "workspace:read",
      scope: "workspace",
      sessionOnly: true,
    });
    expect(
      selectSettingsHistoryPolicy("project_membership")?.policy,
    ).toMatchObject({
      capability: "project:read",
      scope: "project",
    });
    expect(
      selectSettingsHistoryPolicy("project_membership")?.policy,
    ).not.toHaveProperty("sessionOnly");
    for (const [type, capability, scope] of [
      ["state", "project:read", "project"],
      ["time_activity", "time_entry:create", "workspace"],
      ["cost_type", "time_entry:manage_rates", "workspace"],
      ["hourly_rate", "time_entry:manage_rates", "workspace"],
      ["budget", "budget:read", "project"],
    ] as const)
      expect(selectSettingsHistoryPolicy(type)?.policy).toMatchObject({
        capability,
        scope,
      });
    expect(selectSettingsHistoryPolicy("user_preference")).toBeUndefined();
    expect(selectSettingsHistoryPolicy("unknown")).toBeUndefined();
    expect(selectSettingsHistoryPolicy("__proto__")).toBeUndefined();
  });

  it("selects automation policies only from the resolved row scope", () => {
    expect(selectSettingsHistoryPolicy("automation")).toBeUndefined();
    const workspaceScope = {
      type: "automation",
      id: "a1",
      workspaceId: WORKSPACE_ID,
      projectId: null,
    };
    const projectScope = { ...workspaceScope, projectId: PROJECT_ID };
    const workspaceEvidence = {
      workspaceId: WORKSPACE_ID,
      workspaceIdSource: "row",
      projectId: null,
      resource: "workspace",
    };
    const projectEvidence = {
      ...workspaceEvidence,
      projectId: PROJECT_ID,
      resource: "project",
    };
    expect(
      selectSettingsHistoryPolicy(
        "automation",
        "a1",
        workspaceScope,
        workspaceEvidence,
      )?.policy,
    ).toMatchObject({
      capability: "workspace:manage_settings",
      scope: "workspace",
    });
    expect(
      selectSettingsHistoryPolicy(
        "automation",
        "a1",
        projectScope,
        projectEvidence,
      )?.policy,
    ).toMatchObject({ capability: "project:read", scope: "project" });
    for (const [scope, evidence, resolved] of [
      [
        workspaceScope,
        workspaceEvidence,
        workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      ],
      [
        projectScope,
        projectEvidence,
        projectScopeFromRow({
          projectId: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
        }),
      ],
    ] as const) {
      const policy = selectSettingsHistoryPolicy(
        "automation",
        "a1",
        scope,
        evidence,
      )?.policy;
      if (!policy) throw new Error("Missing automation policy");
      expect(
        evaluatePolicy(policy, {
          identity: identityFor("customer"),
          target: MATRIX_TARGET,
          scope: resolved,
          inReach: true,
        }).allowed,
      ).toBe(false);
    }
    for (const [scope, evidence] of [
      [undefined, workspaceEvidence],
      [workspaceScope, projectEvidence],
      [workspaceScope, { ...workspaceEvidence, resource: "instance" }],
      [projectScope, workspaceEvidence],
      [{ ...projectScope, id: "other" }, projectEvidence],
      [{ ...projectScope, projectId: undefined }, projectEvidence],
      [{ ...projectScope, type: "workspace" }, projectEvidence],
      [projectScope, { ...projectEvidence, workspaceId: "other" }],
    ] as const)
      expect(
        selectSettingsHistoryPolicy("automation", "a1", scope, evidence),
      ).toBeUndefined();
  });

  it("rejects malformed targets and keeps the self projection closed", () => {
    for (const [after, expected] of [
      [{ kind: "member_role_changed", role: "admin", userId: "u1" }, ["role"]],
      [
        {
          source: "project_roster",
          change: "role_changed",
          role: "project-lead",
        },
        ["role"],
      ],
      [{ kind: "member_role_changed", role: "member", userId: "u1" }, []],
      [
        { source: "project_roster", change: "removed", role: "project-lead" },
        [],
      ],
    ] as const)
      expect(
        entityHistoryRow(
          {
            createdAt: "2026-11-17T00:00:00Z",
            actorType: "person",
            action: "membership.changed",
            before: { role: "member" },
            after: { ...after, secret: "private" },
          },
          "Ada",
        ).changedFields,
      ).toEqual(expected);
    expect(
      settingsHistoryQuery.safeParse({ entity_type: "unknown", entity_id: "x" })
        .success,
    ).toBe(false);
    expect(
      entityHistoryRow(
        {
          createdAt: "2026-11-16T00:00:00Z",
          actorType: "person",
          action: "workflow.cab_template_applied",
          after: { adoptedProjectIds: ["unreached-project"], url: "secret" },
        },
        "Allowed actor",
      ),
    ).toEqual({
      at: "2026-11-16T00:00:00Z",
      actor: { kind: "person", name: "Allowed actor" },
      action: "workflow.cab_template_applied",
      changedFields: [],
    });
    expect(
      entityHistoryRow(
        {
          createdAt: "2026-11-16T00:00:00Z",
          actorType: "api_key",
          action: "workspace.settings_updated",
          after: { changedFields: ["name", "secret", "slug"] },
        },
        null,
      ).changedFields,
    ).toEqual(["name", "slug"]);
    expect(
      entityHistoryRow(
        {
          createdAt: "2026-11-16T00:00:00Z",
          actorType: "person",
          action: "instance.settings_changed",
          after: { changedKeys: ["timezone", "secret"] },
        },
        "Ada",
      ).changedFields,
    ).toEqual(["timezone"]);
    expect(
      entityHistoryRow(
        {
          createdAt: "2026-11-16T00:00:00Z",
          actorType: "person",
          action: "project.settings_updated",
          after: { changedFields: ["slaPolicy", "secret"] },
        },
        "Ada",
      ).changedFields,
    ).toEqual(["slaPolicy"]);
    expect(
      entityHistoryRow(
        {
          createdAt: "2026-11-16T00:00:00Z",
          actorType: "api_key",
          action: "workspace.settings_updated",
          after: null,
        },
        "must not show a person name",
      ).actor,
    ).toEqual({ kind: "api_key", name: null });
    for (const [action, approved] of [
      ["project.general_settings_updated", ["name", "health"]],
      ["project.states_updated", ["position", "isDefault"]],
      ["workflow.version_created", ["definition"]],
      ["label.catalogue_updated", ["name", "color"]],
      ["canned_response.updated", ["body", "visibilityDefault"]],
    ] as const) {
      expect(
        entityHistoryRow(
          {
            createdAt: "2026-11-16T00:00:00Z",
            actorType: "person",
            action,
            after: {
              changedFields: [...approved, "secret", "url"],
              body: "private",
            },
          },
          "Ada",
        ).changedFields,
      ).toEqual(approved);
    }
    expect(
      settingsHistoryQuery.safeParse({
        entity_type: "workspace",
        entity_id: "x\u0000",
      }).success,
    ).toBe(false);
    expect(
      safePreferenceAuditFields({
        changedFields: ["density", "secret", 12, "density", "layout"],
      }),
    ).toEqual(["density", "layout"]);
    expect(safePreferenceAuditFields({ changedFields: "density" })).toEqual([]);
    expect(
      settingsHistoryQuery.safeParse({
        entity_type: "user_preference",
        entity_id: "self",
      }).success,
    ).toBe(false);
    expect(
      settingsHistoryResponseSchema.safeParse({
        entityType: "user_preference",
        entityId: "self",
        lastChanged: null,
        rows: [{ id: "raw-audit-id" }],
      }).success,
    ).toBe(false);
    expect(
      settingsHistoryResponseSchema.safeParse({
        entityType: "user_preference",
        entityId: "self",
        lastChanged: null,
        rows: [
          {
            at: "2026-11-16T00:00:00Z",
            actor: "you",
            changedFields: ["density"],
            auditId: "raw-audit-id",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps each selected capability effective", () => {
    const scopes = {
      instance: instanceScope(),
      workspace: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      project: projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
      role: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      workflow: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      team: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      service_calendar: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      sla_policy: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      request_type: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      custom_field: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      custom_field_section: workspaceScopeFromRow({
        workspaceId: WORKSPACE_ID,
      }),
      state_template: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      webhook: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      canned_response: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      workspace_label: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      project_label: projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
      state: projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
      time_activity: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      cost_type: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      hourly_rate: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      budget: projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
      workspace_member: workspaceScopeFromRow({ workspaceId: WORKSPACE_ID }),
      project_membership: projectScopeFromRow({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      }),
    } as const;
    for (const type of Object.keys(scopes) as Array<keyof typeof scopes>) {
      const policy = selectSettingsHistoryPolicy(type)?.policy;
      if (!policy) throw new Error(`Missing ${type} policy`);
      expect(
        evaluatePolicy(policy, {
          identity: identityFor("customer"),
          target: MATRIX_TARGET,
          scope: scopes[type],
          inReach: true,
        }).allowed,
      ).toBe(false);
    }
  });
});
