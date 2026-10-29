import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemKaneoListModule = typeof import("./work-item-kaneo-list");

let loaded: WorkItemKaneoListModule | undefined;
let pending: Promise<WorkItemKaneoListModule> | undefined;

/**
 * Loader for the grouped list (`?layout=list`). The panel checks readiness with
 * `useModuleReady` so the read-only preview (`WorkItemLightList`) can paint its first viewport
 * immediately from query data before the heavy interactive list modules arrive (G11 work-list LCP).
 */
export default function loadWorkItemKaneoList(): Promise<WorkItemKaneoListModule> {
  if (loaded) return loadedModuleThenable(loaded);
  pending ??= import("./work-item-kaneo-list").then(
    (module) => {
      loaded = module;
      return module;
    },
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

export function isWorkItemKaneoListLoaded() {
  return loaded !== undefined;
}

export function preloadWorkItemKaneoList() {
  if (!loaded) void loadWorkItemKaneoList().catch(() => undefined);
}
