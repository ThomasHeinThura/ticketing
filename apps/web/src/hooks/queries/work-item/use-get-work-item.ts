import { useQuery } from "@tanstack/react-query";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";

export const WORK_ITEM_REFRESH_INTERVAL_MS = 30_000;

function useGetWorkItem({ key }: { key: string | undefined }) {
  const { isUnavailable: isRealtimeUnavailable } = useNativeWorkItemRealtime(
    key ? [`work_item:${key}`] : [],
  );
  const query = useQuery({
    queryKey: ["work-items", "detail", key],
    queryFn: () => getWorkItem(key as string),
    enabled: !!key,
    refetchInterval: isRealtimeUnavailable
      ? WORK_ITEM_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  return { ...query, isRealtimeUnavailable };
}

export default useGetWorkItem;
