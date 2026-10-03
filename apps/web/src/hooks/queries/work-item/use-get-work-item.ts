import { useQuery } from "@tanstack/react-query";
import getWorkItem from "@/fetchers/work-item/get-work-item";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";

function useGetWorkItem({ key }: { key: string | undefined }) {
  const { isUnavailable: isRealtimeUnavailable } = useNativeWorkItemRealtime(
    key ? [`work_item:${key}`] : [],
  );
  const query = useQuery({
    queryKey: ["work-items", "detail", key],
    queryFn: () => getWorkItem(key as string),
    enabled: !!key,
    refetchInterval: isRealtimeUnavailable ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  return { ...query, isRealtimeUnavailable };
}

export default useGetWorkItem;
