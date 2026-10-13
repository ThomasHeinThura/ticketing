import { queryOptions } from "@tanstack/react-query";
import { getOwnPendingActions } from "@/fetchers/pending-actions";

/**
 * The pending-actions list must show the server's current pending set every
 * time the list is opened. The app-wide default is `refetchOnMount: false`, so
 * without `"always"` an approval made on the detail page (while this list is
 * unmounted, hence only marked invalidated) would leave the approved action
 * visible as pending on back-navigation.
 */
export function ownPendingActionsQuery(cursor?: string) {
  return queryOptions({
    queryKey: ["me", "pending-actions", cursor ?? null],
    queryFn: () => getOwnPendingActions(cursor),
    staleTime: 0,
    refetchOnMount: "always",
  });
}
