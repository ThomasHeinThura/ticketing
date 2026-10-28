import { loadedModuleThenable } from "./loaded-module-thenable";

type VirtualizedSortableListModule =
  typeof import("./virtualization/virtualized-sortable-list");

let loaded: VirtualizedSortableListModule | undefined;

/**
 * Loader for the Kaneo list's virtual window. Once the module is here it resolves in the same
 * render (see `loadedModuleThenable`), so a `lazy` boundary around it shows no fallback.
 */
export default function loadVirtualizedSortableList(): Promise<VirtualizedSortableListModule> {
  if (loaded) return loadedModuleThenable(loaded);
  return import("./virtualization/virtualized-sortable-list").then((module) => {
    loaded = module;
    return module;
  });
}

/** Whether the module has loaded, so a caller can render it without a Suspense pass. */
export function isVirtualizedSortableListLoaded() {
  return loaded !== undefined;
}
