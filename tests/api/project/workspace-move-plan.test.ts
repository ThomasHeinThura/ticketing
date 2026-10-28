import { describe, expect, it } from "vitest";
import {
  buildWorkspaceMovePlan,
  type WorkspaceMovePlanInput,
} from "../../../apps/api/src/project/workspace-move-plan";

function rowAt<T>(rows: readonly T[], index = 0): T {
  const row = rows[index];
  if (!row) throw new Error(`Missing fixture row at index ${index}`);
  return row;
}

function fixture(): WorkspaceMovePlanInput {
  return {
    sourceWorkspace: { id: "ws-old", organisationId: "org-a" },
    destinationWorkspace: { id: "ws-new", organisationId: "org-a" },
    rootProjectId: "project-root",
    source: {
      projects: [
        {
          id: "project-root",
          workspaceId: "ws-old",
          organisationId: "org-a",
          parentId: null,
          ownerTeamId: "team-old",
          managerId: "person-old",
          defaultAssigneeId: "person-old",
          slaPolicyKey: "standard",
          serviceCalendarKey: "weekdays",
          requiredRoleIds: ["role-old"],
        },
        {
          id: "project-child",
          workspaceId: "ws-old",
          organisationId: "org-a",
          parentId: "project-root",
          ownerTeamId: null,
          managerId: null,
          defaultAssigneeId: null,
          slaPolicyKey: null,
          serviceCalendarKey: null,
          requiredRoleIds: [],
        },
      ],
      types: [
        {
          id: "type-old",
          key: "task",
          category: "standard",
          isEpic: false,
          isChange: false,
          workflowKey: "delivery",
        },
      ],
      workflows: [
        {
          id: "workflow-old",
          key: "delivery",
          roleIds: ["role-old"],
          outboundStateKeys: ["open"],
          hasAnyStateTransition: false,
        },
      ],
      stateTemplates: [
        {
          id: "state-template-old",
          key: "open",
          group: "open",
          archived: false,
        },
      ],
      labels: [{ id: "label-old", key: "customer_visible" }],
      slaPolicies: [
        { id: "sla-old", key: "standard", calendarKey: "weekdays" },
      ],
      calendars: [{ id: "calendar-old", key: "weekdays" }],
      customFields: [
        {
          id: "field-old",
          key: "impact",
          format: "select",
          options: [{ key: "high", label: "High" }],
        },
      ],
      teams: [{ id: "team-old", workspaceId: "ws-old" }],
      roles: [
        {
          id: "role-old",
          workspaceId: "ws-old",
          capabilities: ["project:read", "work_item:read"],
        },
      ],
      people: [{ id: "person-old", assignable: true }],
    },
    destination: {
      projects: [],
      types: [
        {
          id: "type-new",
          key: "task",
          category: "standard",
          isEpic: false,
          isChange: false,
          workflowKey: "delivery",
        },
      ],
      workflows: [
        {
          id: "workflow-new",
          key: "delivery",
          roleIds: ["role-new"],
          outboundStateKeys: ["open"],
          hasAnyStateTransition: false,
        },
      ],
      stateTemplates: [
        {
          id: "state-template-new",
          key: "open",
          group: "open",
          archived: false,
        },
      ],
      labels: [{ id: "label-new", key: "customer_visible" }],
      slaPolicies: [
        { id: "sla-new", key: "standard", calendarKey: "weekdays" },
      ],
      calendars: [{ id: "calendar-new", key: "weekdays" }],
      customFields: [
        {
          id: "field-new",
          key: "impact",
          format: "select",
          options: [{ key: "high", label: "High impact" }],
        },
      ],
      teams: [{ id: "team-new", workspaceId: "ws-new" }],
      roles: [
        {
          id: "role-new",
          workspaceId: "ws-new",
          capabilities: ["project:read"],
        },
      ],
      people: [{ id: "person-new", assignable: true }],
    },
    states: [
      {
        id: "state-root",
        projectId: "project-root",
        templateKey: "open",
        typeKey: "task",
      },
      {
        id: "state-child",
        projectId: "project-child",
        templateKey: "open",
        typeKey: "task",
      },
    ],
    workItems: [
      {
        id: "wi-1",
        projectId: "project-root",
        typeKey: "task",
        stateId: "state-root",
        assigneeId: "person-old",
        labelIds: ["label-old"],
      },
      {
        id: "wi-2",
        projectId: "project-child",
        typeKey: "task",
        stateId: "state-child",
        assigneeId: null,
        labelIds: [],
      },
    ],
    customFieldValues: [
      {
        projectId: "project-root",
        workItemId: "wi-1",
        fieldKey: "impact",
        value: "high",
      },
    ],
    slaHistory: [
      {
        workItemId: "wi-1",
        sourceWorkspaceId: "ws-old",
        sourcePolicyKey: "standard",
        sourceVersionId: "sla-version-7",
      },
    ],
    obligations: [],
    explicitMappings: {
      teams: { "team-old": "team-new" },
      roles: { "role-old": "role-new" },
      people: { "person-old": "person-new" },
    },
  };
}

describe("buildWorkspaceMovePlan", () => {
  it("plans the complete same-organisation subtree using stable keys and explicit identity maps", () => {
    const plan = buildWorkspaceMovePlan(fixture());
    expect(plan.ready).toBe(true);
    expect(plan.projectIds).toEqual(["project-child", "project-root"]);
    expect(plan.preservedProjectIds).toEqual(["project-child", "project-root"]);
    expect(plan.preservedWorkItemIds).toEqual(["wi-1", "wi-2"]);
    expect(plan.mappings).toMatchObject({
      types: { "type-old": "type-new" },
      workflows: { "workflow-old": "workflow-new" },
      stateTemplates: { "state-template-old": "state-template-new" },
      labels: { "label-old": "label-new" },
      slaPolicies: { "sla-old": "sla-new" },
      calendars: { "calendar-old": "calendar-new" },
      customFields: { "field-old": "field-new" },
      teams: { "team-old": "team-new" },
      roles: { "role-old": "role-new" },
      people: { "person-old": "person-new" },
    });
    expect(plan.projectParents).toEqual({
      "project-child": "project-root",
      "project-root": null,
    });
    expect(plan.projectStates).toEqual({
      "state-child": {
        id: "state-child",
        projectId: "project-child",
        workItemTypeId: "type-new",
        stateTemplateId: "state-template-new",
      },
      "state-root": {
        id: "state-root",
        projectId: "project-root",
        workItemTypeId: "type-new",
        stateTemplateId: "state-template-new",
      },
    });
    expect(plan.projectSlaPolicies["project-root"]).toBe("sla-new");
    expect(plan.projectCalendars["project-root"]).toBe("calendar-new");
    expect(plan.workItemStates["wi-1"]).toBe("state-root");
    expect(plan.workItemAssignees["wi-1"]).toBe("person-new");
    expect(plan.workItemLabels["wi-1"]).toEqual(["label-new"]);
    expect(plan.customFieldValues).toEqual([
      { workItemId: "wi-1", destinationFieldId: "field-new", value: "high" },
    ]);
    expect(plan.slaHistory).toEqual([
      {
        workItemId: "wi-1",
        sourceWorkspaceId: "ws-old",
        sourcePolicyKey: "standard",
        sourceVersionId: "sla-version-7",
        disposition: "preserve_immutable_origin",
      },
    ]);
    expect(plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fingerprints catalogue and mapping content deterministically regardless of row order", () => {
    const first = fixture();
    const second = fixture();
    second.source = {
      ...second.source,
      projects: [...second.source.projects].reverse(),
      labels: [...second.source.labels].reverse(),
    };
    second.workItems = [...second.workItems].reverse();
    expect(buildWorkspaceMovePlan(first).fingerprint).toBe(
      buildWorkspaceMovePlan(second).fingerprint,
    );
    second.explicitMappings = {
      ...second.explicitMappings,
      people: {
        ...second.explicitMappings.people,
        "person-old": "different-person",
      },
    };
    expect(buildWorkspaceMovePlan(first).fingerprint).not.toBe(
      buildWorkspaceMovePlan(second).fingerprint,
    );
  });

  it("does not require destination matches for unused workspace catalogue entries", () => {
    const input = fixture();
    input.source.types = [
      ...input.source.types,
      {
        id: "type-unused",
        key: "unused",
        category: "standard",
        isEpic: false,
        isChange: false,
        workflowKey: "unused-flow",
      },
    ];
    input.source.workflows = [
      ...input.source.workflows,
      {
        id: "workflow-unused",
        key: "unused-flow",
        roleIds: ["role-unused"],
        outboundStateKeys: ["unused-state"],
        hasAnyStateTransition: false,
      },
    ];
    input.source.stateTemplates = [
      ...input.source.stateTemplates,
      {
        id: "state-template-unused",
        key: "unused-state",
        group: "started",
        archived: false,
      },
    ];
    input.source.labels = [
      ...input.source.labels,
      { id: "label-unused", key: "unused-label" },
    ];
    input.source.slaPolicies = [
      ...input.source.slaPolicies,
      {
        id: "sla-unused",
        key: "unused-policy",
        calendarKey: "unused-calendar",
      },
    ];
    input.source.calendars = [
      ...input.source.calendars,
      { id: "calendar-unused", key: "unused-calendar" },
    ];
    input.source.customFields = [
      ...input.source.customFields,
      {
        id: "field-unused",
        key: "unused-field",
        format: "text",
        options: [],
      },
    ];

    const plan = buildWorkspaceMovePlan(input);
    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  it("preserves historical SLA origin pins from an earlier workspace move", () => {
    const input = fixture();
    input.sourceWorkspace.id = "ws-middle";
    for (const project of input.source.projects)
      project.workspaceId = "ws-middle";
    for (const team of input.source.teams) team.workspaceId = "ws-middle";
    for (const role of input.source.roles) role.workspaceId = "ws-middle";
    rowAt(input.slaHistory).sourceWorkspaceId = "ws-original";

    const plan = buildWorkspaceMovePlan(input);
    expect(plan.ready).toBe(true);
    expect(plan.slaHistory[0]).toMatchObject({
      sourceWorkspaceId: "ws-original",
      sourceVersionId: "sla-version-7",
      disposition: "preserve_immutable_origin",
    });
  });

  it("blocks cross-organisation moves, incomplete parent closure, and parent cycles", () => {
    const crossOrg = fixture();
    crossOrg.destinationWorkspace.organisationId = "org-b";
    expect(
      buildWorkspaceMovePlan(crossOrg).blockers.map((row) => row.code),
    ).toContain("cross_organisation_move_forbidden");

    const missingParent = fixture();
    rowAt(missingParent.source.projects, 1).parentId = "outside-project";
    expect(
      buildWorkspaceMovePlan(missingParent).blockers.map((row) => row.code),
    ).toContain("parent_missing_or_outside_source");

    const cycle = fixture();
    rowAt(cycle.source.projects).parentId = "project-child";
    expect(
      buildWorkspaceMovePlan(cycle).blockers.map((row) => row.code),
    ).toContain("project_parent_cycle");
  });

  it("blocks missing or ambiguous keyed catalogues and incompatible types, states, and workflow transitions", () => {
    const input = fixture();
    rowAt(input.destination.types).isChange = true;
    rowAt(input.destination.stateTemplates).group = "completed";
    rowAt(input.destination.workflows).outboundStateKeys = [];
    input.destination.labels = [];
    rowAt(input.destination.customFields).format = "number";
    rowAt(input.destination.slaPolicies).calendarKey = "alternate";
    const codes = buildWorkspaceMovePlan(input).blockers.map((row) => row.code);
    expect(codes).toContain("work_item_type_incompatible");
    expect(codes).toContain("state_template_incompatible");
    expect(codes).toContain("workflow_transition_not_admissible");
    expect(codes).toContain("work_item_label_unmapped");
    expect(codes).toContain("custom_field_format_mismatch");
    expect(codes).toContain("sla_policy_calendar_mismatch");

    const ambiguous = fixture();
    ambiguous.destination = {
      ...ambiguous.destination,
      labels: [
        ...ambiguous.destination.labels,
        { id: "label-duplicate", key: "customer_visible" },
      ],
    };
    expect(
      buildWorkspaceMovePlan(ambiguous).blockers.map((row) => row.code),
    ).toContain("destination_key_ambiguous");
  });

  it("requires explicit eligible person, team, and non-expanding role mappings", () => {
    const input = fixture();
    input.explicitMappings = {
      ...input.explicitMappings,
      teams: {},
      roles: { ...input.explicitMappings.roles, "role-old": "role-new" },
    };
    rowAt(input.destination.roles).capabilities = [
      "project:read",
      "project:delete",
    ];
    rowAt(input.destination.people).assignable = false;
    const codes = buildWorkspaceMovePlan(input).blockers.map((row) => row.code);
    expect(codes).toContain("explicit_mapping_required");
    expect(codes).toContain("role_mapping_expands_capabilities");
    expect(codes).toContain("person_not_assignable_in_destination");
  });

  it("rejects values invalid under destination option keys and blocks unresolved linked-record obligations", () => {
    const input = fixture();
    rowAt(input.destination.customFields).options = [
      { key: "low", label: "Low" },
    ];
    input.obligations = [
      { kind: "linked_submission", id: "sub-1", workItemId: "wi-1" },
      { kind: "import_profile", id: "profile-1", runId: "run-1" },
      {
        kind: "source_event_subscription",
        id: "subscription-1",
        subscriptionKey: "external",
      },
    ];
    const plan = buildWorkspaceMovePlan(input);
    expect(plan.ready).toBe(false);
    expect(plan.blockers.map((row) => row.code)).toContain(
      "custom_field_value_invalid_at_destination",
    );
    expect(
      plan.blockers.filter(
        (row) => row.code === "move_obligation_requires_explicit_resolution",
      ),
    ).toHaveLength(3);
    expect(plan.obligations.map((row) => row.kind)).toEqual([
      "import_profile",
      "linked_submission",
      "source_event_subscription",
    ]);
  });
});
