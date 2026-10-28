import { useQuery } from "@tanstack/react-query";
import { getReparentPreview } from "@/fetchers/project-member/project-members";

/** `parentId: undefined` means no move is being previewed (the query stays idle). */
export default function useGetReparentPreview(
  projectId: string,
  parentId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["projects", projectId, "ownership-preview", parentId ?? null],
    queryFn: () =>
      getReparentPreview({ projectId, parentId: parentId ?? null }),
    enabled: parentId !== undefined,
    staleTime: 0,
    gcTime: 0,
  });
}
