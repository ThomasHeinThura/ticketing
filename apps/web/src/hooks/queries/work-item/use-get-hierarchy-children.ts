import { useInfiniteQuery } from "@tanstack/react-query";
import { getHierarchyChildren } from "@/fetchers/work-item/get-hierarchy-children";

export function useGetHierarchyChildren(key: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["work-items", "hierarchy", key],
    queryFn: ({ pageParam, signal }) =>
      getHierarchyChildren(key, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.page.nextCursor ?? undefined,
    enabled,
    refetchOnMount: "always",
  });
}
