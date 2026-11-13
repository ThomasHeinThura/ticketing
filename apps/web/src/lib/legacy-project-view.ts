import { parseProjectViewSearch } from "./project-board-search";
import {
  isValidWorkItemKeyParam,
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

/** Preserve both query parameters and `#` fragment when redirecting an old URL. */
export function withLocationSuffix(
  pathname: string,
  location: { searchStr?: string; hash?: string },
): string {
  const searchBody = (location.searchStr ?? "").replace(/^\?/, "");
  const hashBody = (location.hash ?? "").replace(/^#/, "");
  const search = searchBody ? `?${searchBody}` : "";
  const hash = hashBody ? `#${hashBody}` : "";
  return `${pathname}${search}${hash}`;
}
