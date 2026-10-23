import { parseProjectViewSearch } from "./project-board-search";
import { routes } from "./routes";
import { parseWorkItemFilterText } from "./work-item-filter";
import {
  isValidWorkItemKeyParam,
  parseWorkItemListSearch,
  parseWorkItemQueryState,
} from "./work-item-list-search";

export function parseLegacyProjectViewSearch(raw: unknown) {
  const candidate =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const normalized =
    !isValidWorkItemKeyParam(candidate.item) &&
    isValidWorkItemKeyParam(candidate.taskId)
      ? { ...candidate, item: candidate.taskId }
      : candidate;
  return {
    ...parseProjectViewSearch(raw),
    ...parseWorkItemQueryState(normalized),
  };
}

/** Translate only equivalent controls; callers must acknowledge every unsupported one. */
export function translateLegacyProjectView(
  raw: unknown,
  projectKey: string,
  view: "board" | "backlog",
) {
  const legacy = parseLegacyProjectViewSearch(raw);
  const search = parseWorkItemListSearch({
    ...legacy,
    layout: legacy.layout ?? "board",
    sort: legacy.sort === "number" ? "key" : (legacy.sort ?? "position"),
  });
  const unsupported: string[] = [];
  for (const key of ["q", "status", "assignee", "labels", "dueDate"] as const) {
    if (legacy[key]?.length) unsupported.push(key);
  }
  if (legacy.sort === "createdAt") unsupported.push("sort");
  if (legacy.priority?.length) {
    if (
      legacy.priority.every((value) =>
        ["low", "medium", "high", "urgent"].includes(value),
      )
    ) {
      const priority = `priority:in(${legacy.priority.join(",")})`;
      try {
        if (search.filter) parseWorkItemFilterText(search.filter);
        const combined = search.filter
          ? `AND(${search.filter},${priority})`
          : priority;
        if (combined.length <= 8192) search.filter = combined;
        else unsupported.push("priority");
      } catch {
        unsupported.push("priority");
      }
    } else unsupported.push("priority");
  }
  const selected = search.item;
  for (const name of ["hierarchy", "relations"] as const) {
    if (search[name] && selected && search[name]?.itemKey !== selected)
      delete search[name];
  }
  const href = routes.workItemList.build({ projectKey }, search);
  return {
    href: view === "backlog" ? href.replace(/\/work\?/u, "/backlog?") : href,
    unsupported,
    legacyTaskId:
      legacy.taskId && !isValidWorkItemKeyParam(legacy.taskId)
        ? legacy.taskId
        : undefined,
  };
}

/** The ID-scoped read is authoritative; a URL workspace is never accepted by itself. */
export function isAuthorizedLegacyProject(
  project: { id: string; workspaceId: string } | undefined,
  projectId: string,
  workspaceId: string,
) {
  return Boolean(
    project && project.id === projectId && project.workspaceId === workspaceId,
  );
}

export function legacyTaskHref(
  workspaceId: string,
  projectId: string,
  taskId: string,
  actualProjectId: string | undefined,
) {
  if (actualProjectId !== projectId) return undefined;
  return `/dashboard/workspace/${encodeURIComponent(workspaceId)}/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`;
}
