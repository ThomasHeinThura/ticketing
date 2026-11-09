import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemKaneoListModule = typeof import("./work-item-kaneo-list");

let loaded: WorkItemKaneoListModule | undefined;
let pending: Promise<WorkItemKaneoListModule> | undefined;

/**
 * Loader for Kaneo's grouped list (`?layout=list`). The work panel requests it once the
 * list's first-viewport preview has painted, or at once when no preview can stand in (G11
 * work-list LCP); once here, `lazy` reads it in the same render (see `loadedModuleThenable`).
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
