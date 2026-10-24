import { useQuery } from "@tanstack/react-query";
import { getWorkspaceResolvedFeatures } from "@/fetchers/feature-flags";

/**
 * The workspace's effective feature values for navigation (`feature.knowledge_base`, `reports`,
 * `time_tracking`, ...). Readable by every workspace member, unlike the admin switch list. A
 * failed or pending read hides the gated entries: every P5 flag is off by default.
 */
export default function useWorkspaceFeatures(
  workspaceId: string | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: ["features", "workspace", workspaceId, "resolved"],
    queryFn: () => getWorkspaceResolvedFeatures(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
    retry: false,
  });
  const isOn = (key: string) =>
    query.data?.some((feature) => feature.key === key && feature.enabled) ??
    false;
  return { isOn, isLoading: query.isLoading };
}
