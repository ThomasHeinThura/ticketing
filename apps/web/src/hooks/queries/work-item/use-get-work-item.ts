import { useQuery } from "@tanstack/react-query";
import getWorkItem from "@/fetchers/work-item/get-work-item";

export const WORK_ITEM_REFRESH_INTERVAL_MS = 30_000;

function useGetWorkItem({ key }: { key: string | undefined }) {
  return useQuery({
    queryKey: ["work-items", "detail", key],
    queryFn: () => getWorkItem(key as string),
    enabled: !!key,
    refetchInterval: WORK_ITEM_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export default useGetWorkItem;
