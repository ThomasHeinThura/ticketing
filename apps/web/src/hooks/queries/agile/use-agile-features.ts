import { useQuery } from "@tanstack/react-query";
import { getResolvedFeatures } from "@/fetchers/agile";

export type AgileFeatures = {
  cycles: boolean;
  modules: boolean;
  estimates: boolean;
};

const OFF: AgileFeatures = { cycles: false, modules: false, estimates: false };

/**
 * The project's resolved `feature.cycles` / `feature.modules` / `feature.estimates` switches
 * (`ST-1`: project, workspace, instance, default). All three are off by default, so a failed or
 * pending read hides the tabs and the property rows rather than offering a screen the API would
 * answer 404.
 */
export default function useAgileFeatures(projectId: string | undefined) {
  const query = useQuery({
    queryKey: ["agile", "features", projectId],
    queryFn: () => getResolvedFeatures(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const enabled = (key: string) =>
    query.data?.some((feature) => feature.key === key && feature.enabled) ??
    false;
  const features: AgileFeatures = query.data
    ? {
        cycles: enabled("feature.cycles"),
        modules: enabled("feature.modules"),
        estimates: enabled("feature.estimates"),
      }
    : OFF;
  return { features, isLoading: query.isLoading };
}
