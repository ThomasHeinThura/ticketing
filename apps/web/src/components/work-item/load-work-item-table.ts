import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemTableModule = typeof import("./work-item-table");

let loaded: WorkItemTableModule | undefined;
let pending: Promise<WorkItemTableModule> | undefined;

/**
 * Loader for the virtualized work table (`?layout=table` with more than 100 rows). The work
 * route starts it before its data arrives; once the module is here it resolves in the same
 * render (see `loadedModuleThenable`), so the table's `lazy` boundary never paints its
 * full-table fallback (500 rows rendered, then replaced: G11 work-list render).
 */
export default function loadWorkItemTable(): Promise<WorkItemTableModule> {
  if (loaded) return loadedModuleThenable(loaded);
  pending ??= import("./work-item-table").then(
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

export function isWorkItemTableLoaded() {
  return loaded !== undefined;
}

/** Start the download without waiting for it; a failure is left to the `lazy` boundary. */
export function preloadWorkItemTable() {
  if (!loaded) void loadWorkItemTable().catch(() => undefined);
}
