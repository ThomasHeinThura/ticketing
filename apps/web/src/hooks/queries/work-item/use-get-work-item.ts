import { useQuery } from "@tanstack/react-query";
import getWorkItem from "@/fetchers/work-item/get-work-item";

function useGetWorkItem({ key }: { key: string | undefined }) {
  return useQuery({
    queryKey: ["work-items", "detail", key],
    queryFn: () => getWorkItem(key as string),
    enabled: !!key,
  });
}

export default useGetWorkItem;
