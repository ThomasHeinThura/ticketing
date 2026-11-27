import type { QueryClient } from "@tanstack/react-query";
import { canWarmOnThisConnection } from "./load-work-item-side-pane";

/**
 * Starts reading a work item the moment the user shows intent to open it (mouse hover or
 * keyboard focus on its row, or a mouse press), so the read overlaps the click. Touch never
 * calls this, and nothing sweeps rows in idle time. The read goes through the item's own query
 * (`prefetchWorkItemDetail`): it is reused for a few seconds, never written to the cache by hand,
 * and a role or access change is answered by the detail's own refetch (403 clears it).
 */
export function warmWorkItemDetailOnIntent(
  queryClient: QueryClient,
  key: string,
) {
  // Hover is a guess, so it costs nothing on Save-Data or a slow link; the open still reads.
  if (!canWarmOnThisConnection()) return;
  void import("@/hooks/queries/work-item/use-get-work-item")
    .then(({ prefetchWorkItemDetail }) =>
      prefetchWorkItemDetail(queryClient, key),
    )
    .catch(() => undefined);
}
