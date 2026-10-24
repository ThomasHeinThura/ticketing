import { useQuery } from "@tanstack/react-query";
import { getResolvedFeatures } from "@/fetchers/agile";

/**
 * Is `feature.pages` on for this project (project, workspace, instance, default)? Shares the
 * agile switches' read, so one request serves the project tabs. Off while pending or failed.
 */
export default function useProjectPagesFeature(projectId: string | undefined) {
  const query = useQuery({
    queryKey: ["agile", "features", projectId],
    queryFn: () => getResolvedFeatures(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  return (
    query.data?.some(
      (feature) => feature.key === "feature.pages" && feature.enabled,
    ) ?? false
  );
}
