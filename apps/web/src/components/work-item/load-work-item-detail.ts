import { importWithRetry } from "@/lib/lazy-retry";

/**
 * `React.lazy` keeps a rejected loader for good, so a chunk that fails to download is tried
 * again here before the failure reaches the page's error screen.
 */
export default function loadWorkItemDetail() {
  return importWithRetry(() => import("./work-item-detail"));
}
