import {
  type QueryClient,
  type QueryState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import {
  confirmPendingWorkItem,
  sharePendingDetail,
} from "@/lib/work-item-pending";

/**
 * How old a read of this item may be and still serve a mount without asking again: the read
 * started for this visit, by the list's hover prefetch or by the detail route as it starts
 * loading. It matches the list's hover prefetch (`staleTime: 5_000`). Anything older, made before
 * a screen showing the item last closed, or marked changed by realtime or a mutation, is read
 * again on mount.
 */
export const WORK_ITEM_READ_REUSE_MS = 5_000;

export const workItemDetailQueryKey = (key: string | undefined) =>
  ["work-items", "detail", key] as const;

/**
 * When a screen showing each item last closed, per query client. Changes made after that are not
 * seen by realtime, so a read made before it is never reused, however recent: returning to an
 * item always reads it again. A read made after it (this visit's hover or route read) is.
 */
const lastClosedByClient = new WeakMap<QueryClient, Map<string, number>>();

function lastClosed(queryClient: QueryClient) {
  let closed = lastClosedByClient.get(queryClient);
  if (!closed) {
    closed = new Map();
    lastClosedByClient.set(queryClient, closed);
  }
  return closed;
}

function isReusable(updatedAt: number, closedAt: number) {
  return (
    updatedAt > 0 &&
    updatedAt > closedAt &&
    Date.now() - updatedAt < WORK_ITEM_READ_REUSE_MS
  );
}

/**
 * A refusal (403/404 and other final 4xx; `shouldRetryQuery`) answered for this visit answers the
 * same again, so a mount right after it (an unknown key opened from a hovered row or the route's
 * early read) shows it instead of sending the same request again. A dropped request or a 5xx is
 * always tried again on mount.
 */
function isReusableRefusal(
  {
    error,
    errorUpdatedAt,
    status,
  }: Pick<QueryState, "error" | "errorUpdatedAt" | "status">,
  closedAt: number,
) {
  return (
    status === "error" &&
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 408 &&
    error.status !== 429 &&
    isReusable(errorUpdatedAt, closedAt)
  );
}

async function readWorkItem(
  queryClient: QueryClient,
  key: string,
  signal: AbortSignal,
) {
  const row = await getWorkItem(key);
  if (!signal.aborted)
    confirmPendingWorkItem(queryClient, key, row, row.version);
  return row;
}

/**
 * Starts reading the item without waiting for it, so the read runs while the route's code loads
 * instead of after the screen mounts. A read made moments ago, or one in flight, is reused.
 */
export function prefetchWorkItemDetail(queryClient: QueryClient, key: string) {
  void queryClient.prefetchQuery({
    queryKey: workItemDetailQueryKey(key),
    structuralSharing: sharePendingDetail(queryClient, key),
    queryFn: ({ signal }) => readWorkItem(queryClient, key, signal),
    staleTime: WORK_ITEM_READ_REUSE_MS,
  });
}

function useGetWorkItem({ key }: { key: string | undefined }) {
  const queryClient = useQueryClient();
  const { status: realtimeStatus } = useNativeWorkItemRealtime(
    key ? [`work_item:${key}`] : [],
  );
  const closedAt = () => (key ? (lastClosed(queryClient).get(key) ?? 0) : 0);
  const query = useQuery({
    queryKey: workItemDetailQueryKey(key),
    structuralSharing: sharePendingDetail(queryClient, key),
    queryFn: ({ signal }) => readWorkItem(queryClient, key as string, signal),
    enabled: !!key,
    // The detail page and side pane re-read the item on mount (the app default is not to), so
    // opening an item never shows a cached copy that changed while no screen watched it. A read
    // made for this visit moments ago (the hover prefetch or the route's early read) is not sent
    // again: before, every hover-then-open sent the same GET twice.
    refetchOnMount: (current) =>
      current.state.isInvalidated ||
      !isReusable(current.state.dataUpdatedAt, closedAt())
        ? "always"
        : false,
    retryOnMount: (current) => !isReusableRefusal(current.state, closedAt()),
    refetchInterval: realtimeStatus === "available" ? false : 30_000,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    if (!key) return;
    return () => {
      lastClosed(queryClient).set(key, Date.now());
    };
  }, [key, queryClient]);
  return {
    ...query,
    realtimeStatus,
    isRealtimeUnavailable: realtimeStatus === "unavailable",
  };
}

export default useGetWorkItem;
