import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemListModule = typeof import("./work-item-list");

let loaded: WorkItemListModule | undefined;
let pending: Promise<WorkItemListModule> | undefined;

/**
 * Loader for the canonical table (`?layout=table`). The work route requests it from
 * `beforeLoad`, alongside the table's data; once here, `lazy` reads it in the same render (see
 * `loadedModuleThenable`).
 */
export default function loadWorkItemList(): Promise<WorkItemListModule> {
  if (loaded) return loadedModuleThenable(loaded);
  pending ??= import("./work-item-list").then(
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

export function isWorkItemListLoaded() {
  return loaded !== undefined;
}

/** Start the download without waiting for it; a failure is left to the `lazy` boundary. */
export function preloadWorkItemList() {
  if (!loaded) void loadWorkItemList().catch(() => undefined);
}
