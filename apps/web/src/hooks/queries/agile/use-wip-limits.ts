import { useQuery } from "@tanstack/react-query";
import { getWipLimits } from "@/fetchers/agile";

/**
 * The board's work-in-progress limits by state id (`VW-12`). A failed read means "no limits": the
 * board still renders its plain counts.
 */
export default function useWipLimits(projectKey: string | undefined) {
  const query = useQuery({
    queryKey: ["agile", "wip-limits", projectKey],
    queryFn: () => getWipLimits(projectKey as string),
    enabled: Boolean(projectKey),
    staleTime: 30_000,
    retry: false,
  });
  const limits = new Map<string, number>(
    (query.data?.data ?? []).map((entry) => [entry.stateId, entry.limit]),
  );
  return { limits, canManage: query.data?.canManage ?? false, query };
}
