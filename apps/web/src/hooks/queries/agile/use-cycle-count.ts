import { useQuery } from "@tanstack/react-query";
import { FeatureDisabledError, getCycles } from "@/fetchers/agile";
import useGetProjects from "@/hooks/queries/project/use-get-projects";

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

/**
 * Whether cycle controls are offered for a project: the feature is on and, for a managed
 * service, it still holds cycles from before (no new ones are created; 27 Nov 2026).
 */
export function useCyclesOffered(
  projectId: string | undefined,
  workspaceId: string | undefined,
  cyclesFeature: boolean,
) {
  // The workspace project list is already cached on every project screen.
  const { data: projects } = useGetProjects({ workspaceId: workspaceId ?? "" });
  const project = projects?.find((candidate) => candidate.id === projectId);
  const managed = project?.kind === "managed_service";
  const count = useCycleCount(project?.slug, managed && cyclesFeature);
  return cyclesFeature && (!managed || (count ?? 0) > 0);
}
