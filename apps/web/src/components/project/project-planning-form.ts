// Pure form logic for the project planning controls (manager, start and end date, default
// assignee) and the project key rules. Kept free of React so it can be unit-tested; the server
// remains the authority (`PUT /api/project/{id}`, `PATCH /api/projects/{id}/ownership`).

export type PlanningValues = {
  managerId: string | null;
  defaultAssigneeId: string | null;
  startDate: string | null;
  endDate: string | null;
};

export type PlanningErrors = { endBeforeStart?: true };

/** PR-13: a project key is 2-8 uppercase letters. Mirrors `PROJECT_KEY_PATTERN` in the API. */
export const PROJECT_KEY_PATTERN = /^[A-Z]{2,8}$/;

export type ProjectKeyError = "required" | "format";

/** `legacy` is the key the project already has: an unchanged legacy key stays valid (the
 * server checks the format only when the key changes). */
export function projectKeyError(
  key: string,
  legacy?: string | null,
): ProjectKeyError | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) return "required";
  if (legacy !== undefined && legacy !== null && trimmed === legacy)
    return null;
  return PROJECT_KEY_PATTERN.test(trimmed) ? null : "format";
}

export function toPlanningValues(project: {
  managerId?: unknown;
  defaultAssigneeId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}): PlanningValues {
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : null;
  return {
    managerId: text(project.managerId),
    defaultAssigneeId: text(project.defaultAssigneeId),
    startDate: text(project.startDate),
    endDate: text(project.endDate),
  };
}

export function isPlanningDirty(
  saved: PlanningValues,
  draft: PlanningValues,
): boolean {
  return (
    saved.managerId !== draft.managerId ||
    saved.defaultAssigneeId !== draft.defaultAssigneeId ||
    saved.startDate !== draft.startDate ||
    saved.endDate !== draft.endDate
  );
}

/** An end date before the start date is refused by the server (422) and by the database. */
export function validatePlanning(values: PlanningValues): PlanningErrors {
  if (
    values.startDate !== null &&
    values.endDate !== null &&
    values.endDate < values.startDate
  ) {
    return { endBeforeStart: true };
  }
  return {};
}

/** Only the fields that changed: the server reads an omitted field as "unchanged", so an
 * unrelated save never rewrites (or re-validates) a manager who was deactivated since. */
export function buildPlanningPayload(
  saved: PlanningValues,
  draft: PlanningValues,
) {
  return {
    ...(saved.managerId !== draft.managerId
      ? { managerId: draft.managerId }
      : {}),
    ...(saved.defaultAssigneeId !== draft.defaultAssigneeId
      ? { defaultAssigneeId: draft.defaultAssigneeId }
      : {}),
    ...(saved.startDate !== draft.startDate
      ? { startDate: draft.startDate }
      : {}),
    ...(saved.endDate !== draft.endDate ? { endDate: draft.endDate } : {}),
  };
}

/** A calendar day to the `YYYY-MM-DD` string the API stores (local calendar day, no time). */
export function dayToDateString(day: Date | undefined): string | null {
  if (!day) return null;
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type PlanningSaveFailure =
  | "forbidden"
  | "notFound"
  | "personNotEligible"
  | "datesOrdered"
  | "keyFormat"
  | "keyTaken"
  | "generic";

/** Map an API failure to a translatable reason by status and stable code, never by echoing
 * server text. */
export function classifyPlanningFailure(
  status: number | undefined,
  message: string | undefined,
): PlanningSaveFailure {
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "keyTaken";
  if (status === 400 && message?.includes("PR-13")) return "keyFormat";
  if (status === 422) {
    if (message?.includes("end_date_before_start_date")) return "datesOrdered";
    if (message?.includes("must_be_active_project_member"))
      return "personNotEligible";
  }
  return "generic";
}

export type OwnershipFailure =
  | "forbidden"
  | "notFound"
  | "parentNotFound"
  | "parentArchived"
  | "cycle"
  | "depth"
  | "generic";

export function classifyOwnershipFailure(
  status: number | undefined,
  message: string | undefined,
): OwnershipFailure {
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 422) {
    if (message?.includes("project_parent_archived")) return "parentArchived";
    if (message?.includes("project_parent_not_found")) return "parentNotFound";
    if (
      message?.includes("project_parent_is_descendant") ||
      message?.includes("project_parent_is_self")
    )
      return "cycle";
    if (message?.includes("PR-1")) return "depth";
  }
  return "generic";
}

type ProjectNode = {
  id: string;
  parentId?: string | null;
  archivedAt?: unknown;
};

/** Projects offered as a parent for `projectId`: not itself, not one of its descendants and
 * not archived. The server still decides the depth cap (4) and the authority. */
export function selectableParents<T extends ProjectNode>(
  projects: readonly T[],
  projectId: string,
): T[] {
  const children = new Map<string, string[]>();
  for (const project of projects) {
    if (!project.parentId) continue;
    const list = children.get(project.parentId) ?? [];
    list.push(project.id);
    children.set(project.parentId, list);
  }
  const excluded = new Set<string>([projectId]);
  const stack = [...(children.get(projectId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || excluded.has(id)) continue;
    excluded.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return projects.filter(
    (project) => !excluded.has(project.id) && !project.archivedAt,
  );
}

/** Level of each project in the loaded list (root = 1); an unknown parent counts as a root. */
export function projectLevels(
  projects: readonly ProjectNode[],
): Map<string, number> {
  const parentOf = new Map(
    projects.map((project) => [project.id, project.parentId ?? null]),
  );
  const levels = new Map<string, number>();
  for (const project of projects) {
    let level = 1;
    const seen = new Set([project.id]);
    let cursor = parentOf.get(project.id) ?? null;
    while (cursor !== null && parentOf.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      level += 1;
      cursor = parentOf.get(cursor) ?? null;
    }
    levels.set(project.id, level);
  }
  return levels;
}

export const COMPOSITION_WARNING_KEYS = ["PR-6", "PR-7", "PR-10"] as const;
export type CompositionWarningKey = (typeof COMPOSITION_WARNING_KEYS)[number];

export function isCompositionWarning(
  value: unknown,
): value is CompositionWarningKey {
  return (COMPOSITION_WARNING_KEYS as readonly unknown[]).includes(value);
}
