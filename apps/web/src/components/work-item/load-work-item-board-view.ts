import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemBoardViewModule = typeof import("./work-item-board-view");

let loaded: WorkItemBoardViewModule | undefined;
let pending: Promise<WorkItemBoardViewModule> | undefined;

/**
 * Loader for the work route's board layout. The route requests it from `beforeLoad` when the URL
 * asks for the board, alongside the board's data, instead of after the route has rendered (G11
 * board render). Once here, `lazy` reads it in the same render (see `loadedModuleThenable`).
 */
export default function loadWorkItemBoardView(): Promise<WorkItemBoardViewModule> {
  if (loaded) return loadedModuleThenable(loaded);
  pending ??= import("./work-item-board-view").then(
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

export function isWorkItemBoardViewLoaded() {
  return loaded !== undefined;
}

/** Start the download without waiting for it; a failure is left to the `lazy` boundary. */
export function preloadWorkItemBoardView() {
  if (!loaded) void loadWorkItemBoardView().catch(() => undefined);
}
