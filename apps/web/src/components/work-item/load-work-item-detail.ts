import { importWithRetry, rememberCssPreloadFailure } from "@/lib/lazy-retry";

/**
 * `React.lazy` keeps a rejected loader for good, so a chunk that fails to download is tried
 * again here before the failure reaches the page's error screen. A failed stylesheet is
 * remembered, so a failure during the list's hover prefetch still reaches the error screen when
 * the detail is opened, instead of the detail rendering without its styles.
 */
const load = rememberCssPreloadFailure(() =>
  importWithRetry(() => import("./work-item-detail")),
);

export default function loadWorkItemDetail() {
  return load();
}
