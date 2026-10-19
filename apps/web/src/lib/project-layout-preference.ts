import type { WorkItemListLayout } from "./work-item-list-search";

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

export function projectLayoutSettingKey(projectId: string): string {
  return `layout.${projectId}`;
}

function projectLayoutKey(userId: string, projectId: string) {
  return `taskdesk:project-layout:${userId}:${projectId}`;
}

function defaultProjectLayoutKey(projectId: string) {
  return `taskdesk.layout.${projectId}`;
}

export function readProjectLayoutPreference(
  projectId: string,
): WorkItemListLayout | undefined;
export function readProjectLayoutPreference(
  storage: ProjectLayoutStorage | undefined,
  userId: string | undefined,
  projectId: string,
): "board" | "list" | undefined;
export function readProjectLayoutPreference(
  storageOrProjectId: ProjectLayoutStorage | string | undefined,
  userId?: string,
  projectId?: string,
): WorkItemListLayout | undefined {
  if (typeof storageOrProjectId === "string") {
    const storage = getProjectLayoutStorage();
    if (!storage) return undefined;
    try {
      const layout = storage.getItem(
        defaultProjectLayoutKey(storageOrProjectId),
      );
      return layout === "board" || layout === "list" || layout === "table"
        ? layout
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (!storageOrProjectId || !userId || !projectId) return undefined;
  try {
    const layout = storageOrProjectId.getItem(
      projectLayoutKey(userId, projectId),
    );
    return layout === "board" || layout === "list" ? layout : undefined;
  } catch {
    return undefined;
  }
}

export function writeProjectLayoutPreference(
  projectId: string,
  layout: WorkItemListLayout,
): void;
export function writeProjectLayoutPreference(
  storage: ProjectLayoutStorage | undefined,
  userId: string | undefined,
  projectId: string,
  layout: WorkItemListLayout,
): void;
export function writeProjectLayoutPreference(
  storageOrProjectId: ProjectLayoutStorage | string | undefined,
  userIdOrLayout: string | undefined,
  projectId?: string,
  layout?: WorkItemListLayout,
) {
  if (
    typeof storageOrProjectId === "string" &&
    (userIdOrLayout === "board" ||
      userIdOrLayout === "list" ||
      userIdOrLayout === "table")
  ) {
    const storage = getProjectLayoutStorage();
    if (!storage) return;
    try {
      storage.setItem(
        defaultProjectLayoutKey(storageOrProjectId),
        userIdOrLayout,
      );
    } catch {
      // Storage may be unavailable in private browsing.
    }
    return;
  }
  if (
    !storageOrProjectId ||
    typeof storageOrProjectId === "string" ||
    !userIdOrLayout ||
    !projectId ||
    !layout
  ) {
    return;
  }
  try {
    storageOrProjectId.setItem(
      projectLayoutKey(userIdOrLayout, projectId),
      layout,
    );
  } catch {
    // Storage may be unavailable in private browsing.
  }
}
