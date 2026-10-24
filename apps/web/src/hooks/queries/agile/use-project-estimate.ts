import { useQuery } from "@tanstack/react-query";
import { FeatureDisabledError, getEstimates } from "@/fetchers/agile";

/** The project's estimate scale, or `undefined` while off, loading or unreadable. */
export default function useProjectEstimate(
  projectKey: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["agile", "estimate", projectKey],
    queryFn: async () => {
      try {
        return await getEstimates(projectKey as string);
      } catch (error) {
        if (error instanceof FeatureDisabledError) return null;
        throw error;
      }
    },
    enabled: Boolean(projectKey) && enabled,
    staleTime: 30_000,
  });
}
