import type { i18n as I18nInstance } from "i18next";

export const BATCHED_RESOURCES_CHANGED = "batchedResourcesChanged";
const installed = new WeakSet<I18nInstance>();

/** Coalesce React notifications without changing synchronous resource-store events. */
export function installBatchedResourceUpdates(instance: I18nInstance): void {
  if (installed.has(instance)) return;
  installed.add(instance);
  let pending = false;
  instance.store.on("added", () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      instance.emit(BATCHED_RESOURCES_CHANGED);
    }, 0);
  });
}
