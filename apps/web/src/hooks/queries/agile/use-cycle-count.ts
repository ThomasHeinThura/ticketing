import { useQuery } from "@tanstack/react-query";
import { FeatureDisabledError, getCycles } from "@/fetchers/agile";

/**
 * How many cycles a project holds (undefined until known). Shares the cycles list's cache entry.
 * A managed service gets no new cycles; this tells the UI whether it still has old ones to show.
 */
export default function useCycleCount(
  projectKey: string | undefined,
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: ["agile", "cycles", projectKey],
    queryFn: () => getCycles(projectKey as string),
    enabled: enabled && Boolean(projectKey),
    retry: (count, error) =>
      !(error instanceof FeatureDisabledError) && count < 2,
  });
  if (query.error instanceof FeatureDisabledError) return 0;
  return query.data?.data.length;
}
