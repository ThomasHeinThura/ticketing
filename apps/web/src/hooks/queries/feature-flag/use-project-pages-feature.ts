import { useQuery } from "@tanstack/react-query";
import { getResolvedFeatures } from "@/fetchers/agile";

/**
 * Is `feature` on for this project (project, workspace, instance, default)? Shares the agile
 * switches' read, so one request serves every project tab. `undefined` while pending; off when
 * the read failed (fail closed).
 */
export function useProjectFeatureState(
  projectId: string | undefined,
  feature: string,
): boolean | undefined {
  const query = useQuery({
    queryKey: ["agile", "features", projectId],
    queryFn: () => getResolvedFeatures(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  if (query.isError) return false;
  if (!query.data) return undefined;
  return query.data.some((entry) => entry.key === feature && entry.enabled);
}

/** The same switch read, off while pending or failed (for showing or hiding a tab). */
export function useProjectFeature(
  projectId: string | undefined,
  feature: string,
): boolean {
  return useProjectFeatureState(projectId, feature) ?? false;
}

/** Is `feature.pages` on for this project? Off while pending or failed. */
export default function useProjectPagesFeature(projectId: string | undefined) {
  return useProjectFeature(projectId, "feature.pages");
}
