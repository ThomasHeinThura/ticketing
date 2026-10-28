import { loadedModuleThenable } from "./loaded-module-thenable";

type WorkItemInlineFieldsModule = typeof import("./work-item-inline-fields");

let loaded: WorkItemInlineFieldsModule | undefined;

/**
 * Loader for the list rows' inline controls. Once the module is here it resolves in the same
 * render (see `loadedModuleThenable`), so a `lazy` boundary around it shows no fallback.
 */
export default function loadWorkItemInlineFields(): Promise<WorkItemInlineFieldsModule> {
  if (loaded) return loadedModuleThenable(loaded);
  return import("./work-item-inline-fields").then((module) => {
    loaded = module;
    return module;
  });
}

/** Whether the module has loaded, so a caller can render it without a Suspense pass. */
export function isWorkItemInlineFieldsLoaded() {
  return loaded !== undefined;
}
