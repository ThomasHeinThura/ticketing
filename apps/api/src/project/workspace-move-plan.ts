import { createHash } from "node:crypto";
import { validateFieldValue } from "../custom-field/logic";

/**
 * Pure ST-10 planning input. The caller must build these snapshots from the complete,
 * freshly authorized project subtree and both workspaces' current catalogues. This is not
 * an authorization decision and the fingerprint is not a lock/CAS token.
 */
export type MoveWorkspace = { id: string; organisationId: string };
export type MoveProject = {
  id: string;
  workspaceId: string;
  organisationId: string;
  parentId: string | null;
  ownerTeamId: string | null;
  managerId: string | null;
  defaultAssigneeId: string | null;
  slaPolicyKey: string | null;
  serviceCalendarKey: string | null;
  requiredRoleIds: readonly string[];
};
export type MoveType = {
  id: string;
  key: string;
  category: string;
  isEpic: boolean;
  isChange: boolean;
  workflowKey: string | null;
};
export type MoveWorkflow = {
  id: string;
  key: string;
  /** Source/destination role IDs referenced by its active transitions. */
  roleIds: readonly string[];
  /** State keys with a transition out of them in the active published version. */
  outboundStateKeys: readonly string[];
  /** True when the active version has at least one transition from any state. */
  hasAnyStateTransition: boolean;
};
export type MoveStateTemplate = {
  id: string;
  key: string;
  group: string;
  archived: boolean;
};
export type MoveLabel = { id: string; key: string };
export type MoveSlaPolicy = {
  id: string;
  key: string;
  calendarKey: string | null;
};
export type MoveCalendar = { id: string; key: string };
export type MoveCustomField = {
  id: string;
  key: string;
  format: Parameters<typeof validateFieldValue>[0]["format"];
  options: readonly { key: string; label: string }[];
};
export type MoveConcreteState = {
  id: string;
  projectId: string;
  templateKey: string;
  typeKey: string;
};
export type MoveWorkItem = {
  id: string;
  projectId: string;
  typeKey: string;
  stateId: string;
  assigneeId: string | null;
  labelIds: readonly string[];
};
export type MoveCustomFieldValue = {
  projectId: string;
  workItemId: string;
  fieldKey: string;
  value: unknown;
};
export type MoveTeam = { id: string; workspaceId: string };
export type MoveRole = {
  id: string;
  workspaceId: string;
  capabilities: readonly string[];
};
export type MovePerson = { id: string; assignable: boolean };
export type MoveSlaHistoryPin = {
  workItemId: string;
  sourceWorkspaceId: string;
  sourcePolicyKey: string | null;
  sourceVersionId: string;
};

export type WorkspaceMoveObligation =
  | { kind: "linked_submission"; id: string; workItemId: string }
  | { kind: "import_profile"; id: string; runId: string }
  | { kind: "source_event_subscription"; id: string; subscriptionKey: string };

export type WorkspaceMoveCatalogue = {
  projects: readonly MoveProject[];
  types: readonly MoveType[];
  workflows: readonly MoveWorkflow[];
  stateTemplates: readonly MoveStateTemplate[];
  labels: readonly MoveLabel[];
  slaPolicies: readonly MoveSlaPolicy[];
  calendars: readonly MoveCalendar[];
  customFields: readonly MoveCustomField[];
  teams: readonly MoveTeam[];
  roles: readonly MoveRole[];
  people: readonly MovePerson[];
};

export type WorkspaceMovePlanInput = {
  sourceWorkspace: MoveWorkspace;
  destinationWorkspace: MoveWorkspace;
  rootProjectId: string;
  source: WorkspaceMoveCatalogue;
  destination: WorkspaceMoveCatalogue;
  states: readonly MoveConcreteState[];
  workItems: readonly MoveWorkItem[];
  customFieldValues: readonly MoveCustomFieldValue[];
  slaHistory: readonly MoveSlaHistoryPin[];
  obligations: readonly WorkspaceMoveObligation[];
  explicitMappings: {
    teams: Readonly<Record<string, string>>;
    roles: Readonly<Record<string, string>>;
    people: Readonly<Record<string, string>>;
  };
};

export type WorkspaceMoveBlocker = {
  code: string;
  entity: string;
  sourceId?: string;
  key?: string;
  detail?: string;
};

export type WorkspaceMovePlan = {
  ready: boolean;
  fingerprint: string;
  projectIds: string[];
  /** Existing project/work-item IDs are preserved by this plan. */
  preservedProjectIds: string[];
  preservedWorkItemIds: string[];
  mappings: {
    types: Record<string, string>;
    workflows: Record<string, string>;
    stateTemplates: Record<string, string>;
    labels: Record<string, string>;
    slaPolicies: Record<string, string>;
    calendars: Record<string, string>;
    customFields: Record<string, string>;
    teams: Record<string, string>;
    roles: Record<string, string>;
    people: Record<string, string>;
  };
  projectParents: Record<string, string | null>;
  /** Concrete project-state IDs stay intact; only their workspace references change. */
  projectStates: Record<
    string,
    {
      id: string;
      projectId: string;
      workItemTypeId: string;
      stateTemplateId: string;
    }
  >;
  projectOwnerTeams: Record<string, string | null>;
  projectPeople: Record<
    string,
    { managerId: string | null; defaultAssigneeId: string | null }
  >;
  projectSlaPolicies: Record<string, string | null>;
  projectCalendars: Record<string, string | null>;
  workItemTypes: Record<string, string>;
  workItemStates: Record<string, string>;
  workItemAssignees: Record<string, string | null>;
  workItemLabels: Record<string, string[]>;
  customFieldValues: Array<{
    workItemId: string;
    destinationFieldId: string;
    value: unknown;
  }>;
  /** Historical clock meaning stays anchored to its original workspace/version. */
  slaHistory: Array<
    MoveSlaHistoryPin & { disposition: "preserve_immutable_origin" }
  >;
  /** These must be explicitly handled by a future executor before the move can proceed. */
  obligations: WorkspaceMoveObligation[];
  blockers: WorkspaceMoveBlocker[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function mapByKey<T extends { id: string; key: string }>(
  source: readonly T[],
  destination: readonly T[],
  entity: string,
  blockers: WorkspaceMoveBlocker[],
): Record<string, string> {
  const sourceKeys = new Map<string, T[]>();
  const destinationKeys = new Map<string, T[]>();
  for (const row of source)
    sourceKeys.set(row.key, [...(sourceKeys.get(row.key) ?? []), row]);
  for (const row of destination)
    destinationKeys.set(row.key, [
      ...(destinationKeys.get(row.key) ?? []),
      row,
    ]);
  const result: Record<string, string> = {};
  for (const [key, rows] of [...sourceKeys].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const sourceRow = rows[0];
    if (!sourceRow) continue;
    if (rows.length !== 1) {
      blockers.push({ code: "source_key_ambiguous", entity, key });
      continue;
    }
    const targets = destinationKeys.get(key) ?? [];
    if (targets.length === 0) {
      blockers.push({
        code: "destination_key_missing",
        entity,
        sourceId: sourceRow.id,
        key,
      });
    } else if (targets.length > 1) {
      blockers.push({
        code: "destination_key_ambiguous",
        entity,
        sourceId: sourceRow.id,
        key,
      });
    } else {
      const target = targets[0];
      if (target) result[sourceRow.id] = target.id;
    }
  }
  return result;
}

function subtree(
  input: WorkspaceMovePlanInput,
  blockers: WorkspaceMoveBlocker[],
): MoveProject[] {
  const rows = input.source.projects;
  const byId = new Map<string, MoveProject[]>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  for (const [id, matching] of byId) {
    if (matching.length > 1)
      blockers.push({
        code: "project_id_ambiguous",
        entity: "project",
        sourceId: id,
      });
  }
  const rootRows = byId.get(input.rootProjectId) ?? [];
  if (rootRows.length !== 1) {
    blockers.push({
      code: "root_project_missing_or_ambiguous",
      entity: "project",
      sourceId: input.rootProjectId,
    });
    return [];
  }
  const sourceProjects = new Map(
    [...byId].flatMap(([id, matches]) => {
      const [project] = matches;
      return matches.length === 1 && project ? [[id, project] as const] : [];
    }),
  );
  const children = new Map<string, string[]>();
  for (const project of sourceProjects.values()) {
    if (
      project.workspaceId !== input.sourceWorkspace.id ||
      project.organisationId !== input.sourceWorkspace.organisationId
    ) {
      blockers.push({
        code: "project_outside_source_scope",
        entity: "project",
        sourceId: project.id,
      });
    }
    if (project.parentId !== null) {
      const parent = sourceProjects.get(project.parentId);
      if (!parent) {
        blockers.push({
          code: "parent_missing_or_outside_source",
          entity: "project",
          sourceId: project.id,
        });
      } else if (
        parent.workspaceId !== project.workspaceId ||
        parent.organisationId !== project.organisationId
      ) {
        blockers.push({
          code: "parent_scope_mismatch",
          entity: "project",
          sourceId: project.id,
        });
      }
      children.set(project.parentId, [
        ...(children.get(project.parentId) ?? []),
        project.id,
      ]);
    }
  }
  const included = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) {
      blockers.push({
        code: "project_parent_cycle",
        entity: "project",
        sourceId: id,
      });
      return;
    }
    if (included.has(id)) return;
    const project = sourceProjects.get(id);
    if (!project) return;
    active.add(id);
    included.add(id);
    for (const childId of (children.get(id) ?? []).sort()) visit(childId);
    active.delete(id);
  };
  visit(input.rootProjectId);
  return [...included]
    .flatMap((id) => {
      const project = sourceProjects.get(id);
      return project ? [project] : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function explicitIdMappings(
  requiredIds: readonly string[],
  declared: Readonly<Record<string, string>>,
  sourceRows: readonly { id: string; workspaceId: string }[],
  destinationRows: readonly { id: string; workspaceId: string }[],
  sourceWorkspaceId: string,
  destinationWorkspaceId: string,
  entity: string,
  blockers: WorkspaceMoveBlocker[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const sourceIds = new Set(sourceRows.map((row) => row.id));
  const destinationById = new Map<string, (typeof destinationRows)[number][]>();
  for (const row of destinationRows)
    destinationById.set(row.id, [...(destinationById.get(row.id) ?? []), row]);
  for (const id of sortedUnique(requiredIds)) {
    const sourceMatches = sourceRows.filter((row) => row.id === id);
    if (
      sourceMatches.length !== 1 ||
      sourceMatches[0]?.workspaceId !== sourceWorkspaceId
    ) {
      blockers.push({
        code: "source_mapping_entity_missing_or_foreign",
        entity,
        sourceId: id,
      });
      continue;
    }
    const targetId = declared[id];
    const targets = targetId ? (destinationById.get(targetId) ?? []) : [];
    if (!targetId) {
      blockers.push({
        code: "explicit_mapping_required",
        entity,
        sourceId: id,
      });
    } else if (
      targets.length !== 1 ||
      targets[0]?.workspaceId !== destinationWorkspaceId
    ) {
      blockers.push({
        code: "destination_mapping_entity_missing_or_foreign",
        entity,
        sourceId: id,
      });
    } else {
      result[id] = targetId;
    }
  }
  for (const sourceId of Object.keys(declared)) {
    if (!sourceIds.has(sourceId))
      blockers.push({ code: "mapping_source_not_in_scope", entity, sourceId });
  }
  return result;
}

function _normalizeOptions(field: MoveCustomField) {
  return [...field.options]
    .map(({ key, label }) => ({ key, label }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizedCatalogue(
  catalogue: WorkspaceMoveCatalogue,
): WorkspaceMoveCatalogue {
  return {
    projects: [...catalogue.projects]
      .map((row) => ({
        ...row,
        requiredRoleIds: sortedUnique(row.requiredRoleIds),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    types: [...catalogue.types].sort((a, b) => a.id.localeCompare(b.id)),
    workflows: [...catalogue.workflows]
      .map((row) => ({
        ...row,
        roleIds: sortedUnique(row.roleIds),
        outboundStateKeys: sortedUnique(row.outboundStateKeys),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    stateTemplates: [...catalogue.stateTemplates].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    labels: [...catalogue.labels].sort((a, b) => a.id.localeCompare(b.id)),
    slaPolicies: [...catalogue.slaPolicies].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    calendars: [...catalogue.calendars].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    customFields: [...catalogue.customFields]
      .map((field) => ({ ...field, options: _normalizeOptions(field) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    teams: [...catalogue.teams].sort((a, b) => a.id.localeCompare(b.id)),
    roles: [...catalogue.roles]
      .map((role) => ({
        ...role,
        capabilities: sortedUnique(role.capabilities),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    people: [...catalogue.people].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function normalizedFingerprintInput(input: WorkspaceMovePlanInput) {
  return {
    ...input,
    source: normalizedCatalogue(input.source),
    destination: normalizedCatalogue(input.destination),
    states: [...input.states].sort((a, b) => a.id.localeCompare(b.id)),
    workItems: [...input.workItems]
      .map((item) => ({ ...item, labelIds: sortedUnique(item.labelIds) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    customFieldValues: [...input.customFieldValues].sort((a, b) =>
      `${a.workItemId}:${a.fieldKey}`.localeCompare(
        `${b.workItemId}:${b.fieldKey}`,
      ),
    ),
    slaHistory: [...input.slaHistory].sort((a, b) =>
      `${a.workItemId}:${a.sourceVersionId}`.localeCompare(
        `${b.workItemId}:${b.sourceVersionId}`,
      ),
    ),
    obligations: [...input.obligations].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
  };
}

/** Builds a deterministic, fail-closed mapping plan from complete authorized snapshots. */
export function buildWorkspaceMovePlan(
  input: WorkspaceMovePlanInput,
): WorkspaceMovePlan {
  const blockers: WorkspaceMoveBlocker[] = [];
  if (input.sourceWorkspace.id === input.destinationWorkspace.id)
    blockers.push({ code: "same_workspace", entity: "workspace" });
  if (
    input.sourceWorkspace.organisationId !==
    input.destinationWorkspace.organisationId
  )
    blockers.push({
      code: "cross_organisation_move_forbidden",
      entity: "workspace",
    });

  const projects = subtree(input, blockers);
  const projectIds = projects.map((project) => project.id);
  const projectSet = new Set(projectIds);
  if (
    projects.some(
      (project) =>
        project.id === input.rootProjectId && project.parentId !== null,
    )
  ) {
    blockers.push({
      code: "move_root_has_parent_outside_subtree",
      entity: "project",
      sourceId: input.rootProjectId,
    });
  }
  const states = input.states.filter((state) =>
    projectSet.has(state.projectId),
  );
  const workItems = input.workItems.filter((item) =>
    projectSet.has(item.projectId),
  );
  const values = input.customFieldValues.filter((value) =>
    projectSet.has(value.projectId),
  );
  const usedTypeKeys = new Set([
    ...states.map((state) => state.typeKey),
    ...workItems.map((item) => item.typeKey),
  ]);
  const sourceTypesInScope = input.source.types.filter((row) =>
    usedTypeKeys.has(row.key),
  );
  const destinationTypesInScope = input.destination.types.filter((row) =>
    usedTypeKeys.has(row.key),
  );
  const sourceTypeByKey = new Map(
    [...sourceTypesInScope]
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .map((row) => [row.key, row]),
  );
  const targetTypeByKey = new Map(
    [...destinationTypesInScope]
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .map((row) => [row.key, row]),
  );
  const usedWorkflowKeys = new Set(
    [...usedTypeKeys].flatMap((key) => {
      const workflowKey = sourceTypeByKey.get(key)?.workflowKey;
      return workflowKey ? [workflowKey] : [];
    }),
  );
  const sourceWorkflowsInScope = input.source.workflows.filter((row) =>
    usedWorkflowKeys.has(row.key),
  );
  for (const key of usedWorkflowKeys) {
    if (!sourceWorkflowsInScope.some((row) => row.key === key)) {
      blockers.push({
        code: "source_workflow_missing",
        entity: "workflow",
        key,
      });
    }
  }
  const destinationWorkflowsInScope = input.destination.workflows.filter(
    (row) => usedWorkflowKeys.has(row.key),
  );
  const usedStateTemplateKeys = new Set(
    states.map((state) => state.templateKey),
  );
  const sourceStateTemplatesInScope = input.source.stateTemplates.filter(
    (row) => usedStateTemplateKeys.has(row.key),
  );
  const destinationStateTemplatesInScope =
    input.destination.stateTemplates.filter((row) =>
      usedStateTemplateKeys.has(row.key),
    );
  const usedLabelIds = new Set(workItems.flatMap((item) => item.labelIds));
  const sourceLabelsInScope = input.source.labels.filter((row) =>
    usedLabelIds.has(row.id),
  );
  const usedSlaPolicyKeys = new Set(
    projects.flatMap((project) =>
      project.slaPolicyKey ? [project.slaPolicyKey] : [],
    ),
  );
  const sourceSlaPoliciesInScope = input.source.slaPolicies.filter((row) =>
    usedSlaPolicyKeys.has(row.key),
  );
  const destinationSlaPoliciesInScope = input.destination.slaPolicies.filter(
    (row) => usedSlaPolicyKeys.has(row.key),
  );
  const usedCalendarKeys = new Set([
    ...projects.flatMap((project) =>
      project.serviceCalendarKey ? [project.serviceCalendarKey] : [],
    ),
    ...sourceSlaPoliciesInScope.flatMap((policy) =>
      policy.calendarKey ? [policy.calendarKey] : [],
    ),
  ]);
  const sourceCalendarsInScope = input.source.calendars.filter((row) =>
    usedCalendarKeys.has(row.key),
  );
  const destinationCalendarsInScope = input.destination.calendars.filter(
    (row) => usedCalendarKeys.has(row.key),
  );
  const usedCustomFieldKeys = new Set(values.map((row) => row.fieldKey));
  const sourceCustomFieldsInScope = input.source.customFields.filter((row) =>
    usedCustomFieldKeys.has(row.key),
  );
  const destinationCustomFieldsInScope = input.destination.customFields.filter(
    (row) => usedCustomFieldKeys.has(row.key),
  );
  const mappings = {
    types: mapByKey(
      sourceTypesInScope,
      destinationTypesInScope,
      "work_item_type",
      blockers,
    ),
    workflows: mapByKey(
      sourceWorkflowsInScope,
      destinationWorkflowsInScope,
      "workflow",
      blockers,
    ),
    stateTemplates: mapByKey(
      sourceStateTemplatesInScope,
      destinationStateTemplatesInScope,
      "state_template",
      blockers,
    ),
    labels: mapByKey(
      sourceLabelsInScope,
      input.destination.labels.filter((row) =>
        sourceLabelsInScope.some((used) => used.key === row.key),
      ),
      "label",
      blockers,
    ),
    slaPolicies: mapByKey(
      sourceSlaPoliciesInScope,
      destinationSlaPoliciesInScope,
      "sla_policy",
      blockers,
    ),
    calendars: mapByKey(
      sourceCalendarsInScope,
      destinationCalendarsInScope,
      "service_calendar",
      blockers,
    ),
    customFields: mapByKey(
      sourceCustomFieldsInScope,
      destinationCustomFieldsInScope,
      "custom_field",
      blockers,
    ),
    teams: {} as Record<string, string>,
    roles: {} as Record<string, string>,
    people: {} as Record<string, string>,
  };

  for (const sourceType of sourceTypesInScope) {
    const target = targetTypeByKey.get(sourceType.key);
    if (!target) continue;
    if (
      sourceType.category !== target.category ||
      sourceType.isEpic !== target.isEpic ||
      sourceType.isChange !== target.isChange
    ) {
      blockers.push({
        code: "work_item_type_incompatible",
        entity: "work_item_type",
        sourceId: sourceType.id,
        key: sourceType.key,
      });
    }
    if (
      sourceType.workflowKey !== null &&
      target.workflowKey !== sourceType.workflowKey
    ) {
      blockers.push({
        code: "work_item_type_workflow_mismatch",
        entity: "work_item_type",
        sourceId: sourceType.id,
        key: sourceType.key,
      });
    }
  }

  const targetStateByKey = new Map(
    [...destinationStateTemplatesInScope]
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .map((row) => [row.key, row]),
  );
  const sourceStateByKey = new Map(
    [...sourceStateTemplatesInScope]
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .map((row) => [row.key, row]),
  );
  for (const sourceState of sourceStateTemplatesInScope) {
    const target = targetStateByKey.get(sourceState.key);
    if (!target) continue;
    if (sourceState.group !== target.group || target.archived) {
      blockers.push({
        code: "state_template_incompatible",
        entity: "state_template",
        sourceId: sourceState.id,
        key: sourceState.key,
      });
    }
  }

  const targetWorkflowByKey = new Map(
    [...destinationWorkflowsInScope]
      .sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id))
      .map((row) => [row.key, row]),
  );
  for (const sourceWorkflow of sourceWorkflowsInScope) {
    const target = targetWorkflowByKey.get(sourceWorkflow.key);
    if (!target) continue;
    const sourceOutbound = new Set(sourceWorkflow.outboundStateKeys);
    const targetOutbound = new Set(target.outboundStateKeys);
    for (const key of sourceOutbound) {
      if (!targetOutbound.has(key)) {
        blockers.push({
          code: "workflow_transition_not_admissible",
          entity: "workflow",
          sourceId: sourceWorkflow.id,
          key,
        });
      }
    }
    if (sourceWorkflow.hasAnyStateTransition && !target.hasAnyStateTransition) {
      blockers.push({
        code: "workflow_any_state_transition_missing",
        entity: "workflow",
        sourceId: sourceWorkflow.id,
        key: sourceWorkflow.key,
      });
    }
  }

  for (const sourcePolicy of sourceSlaPoliciesInScope) {
    const target = destinationSlaPoliciesInScope.find(
      (row) => row.key === sourcePolicy.key,
    );
    if (!target) continue;
    if (
      sourcePolicy.calendarKey !== null &&
      target.calendarKey !== sourcePolicy.calendarKey
    ) {
      blockers.push({
        code: "sla_policy_calendar_mismatch",
        entity: "sla_policy",
        sourceId: sourcePolicy.id,
        key: sourcePolicy.key,
      });
    }
  }

  const sourceFieldByKey = new Map(
    sourceCustomFieldsInScope.map((row) => [row.key, row]),
  );
  const targetFieldByKey = new Map(
    destinationCustomFieldsInScope.map((row) => [row.key, row]),
  );
  for (const field of sourceCustomFieldsInScope) {
    const target = targetFieldByKey.get(field.key);
    if (!target) continue;
    if (field.format !== target.format) {
      blockers.push({
        code: "custom_field_format_mismatch",
        entity: "custom_field",
        sourceId: field.id,
        key: field.key,
      });
    }
  }

  const stateById = new Map(states.map((state) => [state.id, state]));
  const projectStatePlans: WorkspaceMovePlan["projectStates"] = {};
  const concreteStateIds = new Set<string>();
  for (const state of states) {
    if (concreteStateIds.has(state.id)) {
      blockers.push({
        code: "project_state_id_ambiguous",
        entity: "project_state",
        sourceId: state.id,
      });
      continue;
    }
    concreteStateIds.add(state.id);
    const sourceType = sourceTypeByKey.get(state.typeKey);
    const destinationType = targetTypeByKey.get(state.typeKey);
    const sourceTemplate = sourceStateByKey.get(state.templateKey);
    const destinationTemplate = targetStateByKey.get(state.templateKey);
    if (!sourceType || !destinationType || !mappings.types[sourceType.id]) {
      blockers.push({
        code: "project_state_type_unmapped",
        entity: "project_state",
        sourceId: state.id,
        key: state.typeKey,
      });
    }
    if (
      !sourceTemplate ||
      !destinationTemplate ||
      !mappings.stateTemplates[sourceTemplate.id]
    ) {
      blockers.push({
        code: "project_state_template_unmapped",
        entity: "project_state",
        sourceId: state.id,
        key: state.templateKey,
      });
    }
    if (
      sourceType &&
      destinationType &&
      sourceTemplate &&
      destinationTemplate
    ) {
      projectStatePlans[state.id] = {
        id: state.id,
        projectId: state.projectId,
        workItemTypeId: destinationType.id,
        stateTemplateId: destinationTemplate.id,
      };
    }
  }
  const targetWorkItemTypes: Record<string, string> = {};
  const targetWorkItemStates: Record<string, string> = {};
  const targetWorkItemAssignees: Record<string, string | null> = {};
  const targetWorkItemLabels: Record<string, string[]> = {};
  const neededPeople = new Set<string>();
  const sourceTypes = sourceTypeByKey;
  for (const item of workItems) {
    const sourceType = sourceTypes.get(item.typeKey);
    const targetType = targetTypeByKey.get(item.typeKey);
    const state = stateById.get(item.stateId);
    if (!sourceType || !targetType || !mappings.types[sourceType.id]) {
      blockers.push({
        code: "work_item_type_unresolved",
        entity: "work_item",
        sourceId: item.id,
        key: item.typeKey,
      });
    } else targetWorkItemTypes[item.id] = targetType.id;
    if (!state || state.typeKey !== item.typeKey) {
      blockers.push({
        code: "work_item_state_missing_or_type_mismatch",
        entity: "work_item",
        sourceId: item.id,
        key: item.typeKey,
      });
    } else {
      const projectState = projectStatePlans[state.id];
      if (!projectState) {
        blockers.push({
          code: "work_item_state_unmapped",
          entity: "work_item",
          sourceId: item.id,
          key: state.templateKey,
        });
      } else {
        // Work items retain their project-state FK. The state's template/type FKs are
        // remapped separately in `projectStates` while its concrete ID remains stable.
        targetWorkItemStates[item.id] = state.id;
      }
      const typeWorkflow = sourceTypeByKey.get(item.typeKey)?.workflowKey;
      if (typeWorkflow !== null && typeWorkflow !== undefined) {
        const destinationWorkflow = targetWorkflowByKey.get(typeWorkflow);
        if (
          !destinationWorkflow ||
          (!destinationWorkflow.hasAnyStateTransition &&
            !destinationWorkflow.outboundStateKeys.includes(state.templateKey))
        ) {
          blockers.push({
            code: "current_state_has_no_admissible_transition",
            entity: "work_item",
            sourceId: item.id,
            key: state.templateKey,
          });
        }
      }
    }
    if (item.assigneeId) neededPeople.add(item.assigneeId);
    targetWorkItemAssignees[item.id] = item.assigneeId;
    const mappedLabels: string[] = [];
    for (const labelId of item.labelIds) {
      const label = input.source.labels.find((row) => row.id === labelId);
      const targetId = label ? mappings.labels[label.id] : undefined;
      if (!targetId)
        blockers.push({
          code: "work_item_label_unmapped",
          entity: "work_item",
          sourceId: item.id,
          key: labelId,
        });
      else mappedLabels.push(targetId);
    }
    targetWorkItemLabels[item.id] = mappedLabels.sort();
  }

  const targetValues: WorkspaceMovePlan["customFieldValues"] = [];
  for (const row of values) {
    const sourceField = sourceFieldByKey.get(row.fieldKey);
    const targetField = targetFieldByKey.get(row.fieldKey);
    if (
      !sourceField ||
      !targetField ||
      sourceField.format !== targetField.format ||
      !mappings.customFields[sourceField.id]
    ) {
      blockers.push({
        code: "custom_field_unmapped_or_incompatible",
        entity: "custom_field_value",
        sourceId: row.workItemId,
        key: row.fieldKey,
      });
      continue;
    }
    const checked = validateFieldValue(
      { format: targetField.format, options: [...targetField.options] },
      row.value,
    );
    if (!checked.ok) {
      blockers.push({
        code: "custom_field_value_invalid_at_destination",
        entity: "custom_field_value",
        sourceId: row.workItemId,
        key: row.fieldKey,
        detail: checked.message,
      });
      continue;
    }
    if (canonical(checked.value) !== canonical(row.value)) {
      blockers.push({
        code: "custom_field_value_would_change",
        entity: "custom_field_value",
        sourceId: row.workItemId,
        key: row.fieldKey,
      });
      continue;
    }
    if (sourceField.format === "user") {
      if (typeof row.value === "string") neededPeople.add(row.value);
    } else if (
      sourceField.format === "multi_user" &&
      Array.isArray(row.value)
    ) {
      for (const id of row.value)
        if (typeof id === "string") neededPeople.add(id);
    }
    targetValues.push({
      workItemId: row.workItemId,
      destinationFieldId: targetField.id,
      value: row.value,
    });
  }

  const neededTeams = projects.flatMap((project) =>
    project.ownerTeamId ? [project.ownerTeamId] : [],
  );
  const neededRoles = sortedUnique([
    ...projects.flatMap((project) => project.requiredRoleIds),
    ...sourceWorkflowsInScope.flatMap((workflow) => workflow.roleIds),
  ]);
  for (const project of projects) {
    if (project.managerId) neededPeople.add(project.managerId);
    if (project.defaultAssigneeId) neededPeople.add(project.defaultAssigneeId);
  }
  mappings.teams = explicitIdMappings(
    neededTeams,
    input.explicitMappings.teams,
    input.source.teams,
    input.destination.teams,
    input.sourceWorkspace.id,
    input.destinationWorkspace.id,
    "team",
    blockers,
  );
  mappings.roles = explicitIdMappings(
    neededRoles,
    input.explicitMappings.roles,
    input.source.roles,
    input.destination.roles,
    input.sourceWorkspace.id,
    input.destinationWorkspace.id,
    "role",
    blockers,
  );
  for (const [sourceRoleId, targetRoleId] of Object.entries(mappings.roles)) {
    const sourceRole = input.source.roles.find(
      (row) => row.id === sourceRoleId,
    );
    const targetRole = input.destination.roles.find(
      (row) => row.id === targetRoleId,
    );
    if (!sourceRole || !targetRole) continue;
    if (
      targetRole.capabilities.some(
        (capability) => !sourceRole.capabilities.includes(capability),
      )
    ) {
      blockers.push({
        code: "role_mapping_expands_capabilities",
        entity: "role",
        sourceId: sourceRoleId,
      });
    }
  }
  for (const sourceWorkflow of sourceWorkflowsInScope) {
    const targetWorkflow = targetWorkflowByKey.get(sourceWorkflow.key);
    if (!targetWorkflow) continue;
    const targetRoleIds = new Set(targetWorkflow.roleIds);
    for (const sourceRoleId of sourceWorkflow.roleIds) {
      const targetRoleId = mappings.roles[sourceRoleId];
      if (targetRoleId && !targetRoleIds.has(targetRoleId)) {
        blockers.push({
          code: "workflow_role_not_admissible",
          entity: "workflow",
          sourceId: sourceWorkflow.id,
          key: sourceRoleId,
        });
      }
    }
  }
  const peopleSource = input.source.people.map((row) => ({
    ...row,
    workspaceId: input.sourceWorkspace.id,
  }));
  const peopleDestination = input.destination.people.map((row) => ({
    ...row,
    workspaceId: input.destinationWorkspace.id,
  }));
  mappings.people = explicitIdMappings(
    sortedUnique([...neededPeople]),
    input.explicitMappings.people,
    peopleSource,
    peopleDestination,
    input.sourceWorkspace.id,
    input.destinationWorkspace.id,
    "person",
    blockers,
  );
  const assignableById = new Map(
    input.destination.people.map((row) => [row.id, row.assignable]),
  );
  for (const [sourceId, targetId] of Object.entries(mappings.people)) {
    if (!assignableById.get(targetId))
      blockers.push({
        code: "person_not_assignable_in_destination",
        entity: "person",
        sourceId,
      });
  }
  for (const item of workItems) {
    if (item.assigneeId) {
      targetWorkItemAssignees[item.id] =
        mappings.people[item.assigneeId] ?? item.assigneeId;
    }
  }
  for (const row of targetValues) {
    const destinationField = input.destination.customFields.find(
      (field) => field.id === row.destinationFieldId,
    );
    const sourceField = destinationField
      ? sourceFieldByKey.get(destinationField.key)
      : undefined;
    if (!sourceField) continue;
    if (sourceField.format === "user" && typeof row.value === "string") {
      row.value = mappings.people[row.value] ?? row.value;
    } else if (
      sourceField.format === "multi_user" &&
      Array.isArray(row.value)
    ) {
      row.value = row.value.map((id) =>
        typeof id === "string" ? (mappings.people[id] ?? id) : id,
      );
    }
  }

  const mappedProjectParents: Record<string, string | null> = {};
  const projectOwnerTeams: Record<string, string | null> = {};
  const projectPeople: Record<
    string,
    { managerId: string | null; defaultAssigneeId: string | null }
  > = {};
  const projectSlaPolicies: Record<string, string | null> = {};
  const projectCalendars: Record<string, string | null> = {};
  for (const project of projects) {
    mappedProjectParents[project.id] = project.parentId;
    projectOwnerTeams[project.id] = project.ownerTeamId
      ? (mappings.teams[project.ownerTeamId] ?? null)
      : null;
    projectPeople[project.id] = {
      managerId: project.managerId
        ? (mappings.people[project.managerId] ?? null)
        : null,
      defaultAssigneeId: project.defaultAssigneeId
        ? (mappings.people[project.defaultAssigneeId] ?? null)
        : null,
    };
    const policy = project.slaPolicyKey
      ? input.source.slaPolicies.find((row) => row.key === project.slaPolicyKey)
      : null;
    const calendar = project.serviceCalendarKey
      ? input.source.calendars.find(
          (row) => row.key === project.serviceCalendarKey,
        )
      : null;
    if (project.slaPolicyKey && !policy)
      blockers.push({
        code: "project_sla_policy_missing",
        entity: "project",
        sourceId: project.id,
        key: project.slaPolicyKey,
      });
    if (project.serviceCalendarKey && !calendar)
      blockers.push({
        code: "project_calendar_missing",
        entity: "project",
        sourceId: project.id,
        key: project.serviceCalendarKey,
      });
    projectSlaPolicies[project.id] = policy
      ? (mappings.slaPolicies[policy.id] ?? null)
      : null;
    projectCalendars[project.id] = calendar
      ? (mappings.calendars[calendar.id] ?? null)
      : null;
  }

  for (const pin of input.slaHistory) {
  }
  for (const obligation of input.obligations) {
    blockers.push({
      code: "move_obligation_requires_explicit_resolution",
      entity: obligation.kind,
      sourceId: obligation.id,
    });
  }

  const resultWithoutFingerprint = {
    ready: blockers.length === 0,
    projectIds,
    preservedProjectIds: projectIds,
    preservedWorkItemIds: workItems.map((item) => item.id).sort(),
    mappings,
    projectParents: mappedProjectParents,
    projectStates: projectStatePlans,
    projectOwnerTeams,
    projectPeople,
    projectSlaPolicies,
    projectCalendars,
    workItemTypes: targetWorkItemTypes,
    workItemStates: targetWorkItemStates,
    workItemAssignees: targetWorkItemAssignees,
    workItemLabels: targetWorkItemLabels,
    customFieldValues: targetValues.sort((a, b) =>
      `${a.workItemId}:${a.destinationFieldId}`.localeCompare(
        `${b.workItemId}:${b.destinationFieldId}`,
      ),
    ),
    slaHistory: input.slaHistory
      .filter((pin) => workItems.some((item) => item.id === pin.workItemId))
      .map((pin) => ({
        ...pin,
        disposition: "preserve_immutable_origin" as const,
      }))
      .sort((a, b) =>
        `${a.workItemId}:${a.sourceVersionId}`.localeCompare(
          `${b.workItemId}:${b.sourceVersionId}`,
        ),
      ),
    obligations: [...input.obligations].sort((a, b) =>
      `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
    ),
    blockers: blockers.sort((a, b) => canonical(a).localeCompare(canonical(b))),
  };
  const fingerprint = createHash("sha256")
    .update(
      canonical({
        input: normalizedFingerprintInput(input),
        plan: resultWithoutFingerprint,
      }),
    )
    .digest("hex");
  return { ...resultWithoutFingerprint, fingerprint };
}
