import { useInfiniteQuery } from "@tanstack/react-query";
import getCommentVersionPage from "@/fetchers/work-item/get-comment-version-page";

function useGetCommentVersionHistory({
  key,
  commentId,
  enabled,
}: {
  key: string;
  commentId: string;
  enabled: boolean;
}) {
  return useInfiniteQuery({
    queryKey: ["work-items", "comment-versions", key, commentId],
    queryFn: ({ pageParam }) =>
      getCommentVersionPage({ key, commentId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled,
    // The app default (refetchOnMount: false) would render an invalidated cache
    // when the history control remounts after an edit; history must be current.
    refetchOnMount: "always",
  });
}

export default useGetCommentVersionHistory;
