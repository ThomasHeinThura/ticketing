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

type ConnectionHints = { saveData?: boolean; effectiveType?: string };

/** False on Save-Data and on 2g / slow-2g links, where a speculative download costs the user. */
export function canWarmOnThisConnection(): boolean {
  const connection =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { connection?: ConnectionHints }).connection;
  if (!connection) return true;
  return (
    !connection.saveData &&
    connection.effectiveType !== "2g" &&
    connection.effectiveType !== "slow-2g"
  );
}

/**
 * Warms what opening the pane needs and the user cannot see: the body and detail code, then the
 * deferred strings, so a row click finds both ready and paints no skeleton. It fetches code and
 * strings only, never a work item (item data loads on intent, see `warmWorkItemDetailOnIntent`).
 * Downloads cannot be cancelled once started; `signal` stops the next stage when the user has
 * left the route. Failures are ignored: the pane loads normally when opened.
 */
export async function warmWorkItemSidePane(signal?: AbortSignal) {
  if (signal?.aborted || !canWarmOnThisConnection()) return;
  try {
    // The detail code is warmed through the body (which owns that import), so it stays behind the
    // namespace boundary in the render-graph guard.
    const body = await loadWorkItemSidePane().then((m) =>
      m.loadWorkItemSidePaneBody(),
    );
    await body.warmWorkItemDetail();
    if (signal?.aborted) return;
    // Imported here, not at the top: the route chunk already has the i18n module, and a static
    // import would pull it into every test that loads the loader.
    const { whenAllNamespacesLoaded } = await import("@/lib/i18n");
    await whenAllNamespacesLoaded();
  } catch {
    // Not needed to paint; opening the pane retries.
  }
}
