import { importWithRetry, rememberCssPreloadFailure } from "@/lib/lazy-retry";
import { loadedModuleThenable } from "./loaded-module-thenable";

/**
 * `React.lazy` keeps a rejected loader for good, so a chunk that fails to download is tried
 * again here before the failure reaches the page's error screen. A failed stylesheet is
 * remembered, so a failure during the list's hover prefetch still reaches the error screen when
 * the detail is opened, instead of the detail rendering without its styles.
 */
const load = rememberCssPreloadFailure(() =>
  importWithRetry(() => import("./work-item-detail")),
);

type DetailModule = Awaited<ReturnType<typeof load>>;
let loaded: DetailModule | undefined;
let tracked: Promise<DetailModule> | undefined;

/**
 * Once the module is loaded the loader answers with a synchronous thenable, so `React.lazy` reads
 * it in the same render and a warm detail never commits a fallback first (G11 side pane).
 */
export default function loadWorkItemDetail(): Promise<DetailModule> {
  if (loaded) return loadedModuleThenable(loaded);
  const request = load();
  if (request !== tracked) {
    tracked = request;
    request.then(
      (module) => {
        loaded = module;
      },
      () => undefined,
    );
  }
  return request;
}
