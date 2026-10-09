import type { ProjectBoardLayout } from "./project-board-search";

export interface ProjectLayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getProjectLayoutStorage(): ProjectLayoutStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function projectLayoutKey(userId: string, projectId: string) {
  return `taskdesk:project-layout:${userId}:${projectId}`;
}

export function readProjectLayoutPreference(
  storage: ProjectLayoutStorage | undefined,
  userId: string | undefined,
  projectId: string,
): ProjectBoardLayout | undefined {
  if (!storage || !userId) return undefined;
  try {
    const layout = storage.getItem(projectLayoutKey(userId, projectId));
    return layout === "board" || layout === "list" ? layout : undefined;
  } catch {
    return undefined;
  }
}

export function writeProjectLayoutPreference(
  storage: ProjectLayoutStorage | undefined,
  userId: string | undefined,
  projectId: string,
  layout: ProjectBoardLayout,
) {
  if (!storage || !userId) return;
  try {
    storage.setItem(projectLayoutKey(userId, projectId), layout);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}
