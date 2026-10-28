import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemSidePaneModule = typeof import("./work-item-side-pane");

let loaded: WorkItemSidePaneModule | undefined;

/**
 * Loader for the work list's side pane (`?item=`). The route fetches it once the list has
 * rendered; from then on it resolves in the same render (see `loadedModuleThenable`), so a row
 * click paints the pane's loading state without first suspending (G11 route transition).
 */
export default function loadWorkItemSidePane(): Promise<WorkItemSidePaneModule> {
  if (loaded) return loadedModuleThenable(loaded);
  return import("./work-item-side-pane").then((module) => {
    loaded = module;
    return module;
  });
}
