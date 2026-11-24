import { useQuery } from "@tanstack/react-query";
import resolveProjectKey from "@/fetchers/project/resolve-project-key";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/**
 * The canonical `/agent/projects/{key}` project, found in the active workspace's projects.
 * `enabled: false` reads nothing (for a caller that only sometimes has a project key).
 * When no live project has the key, `currentKey` is the key a renamed project holds now (asked of
 * the reach-gated resolver, only on that miss), so the route can redirect an old link.
 */
export default function useProjectByKey(projectKey: string, enabled = true) {
  const { data: workspace, isLoading: loadingWorkspace } = useActiveWorkspace();
  const { data: projects, isLoading: loadingProjects } = useGetProjects(
    { workspaceId: workspace?.id ?? "" },
    enabled,
  );
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  const missed = enabled && Boolean(workspace) && Boolean(projects) && !project;
  const { data: currentKey } = useQuery({
    queryKey: ["project-key", workspace?.id, projectKey],
    queryFn: () =>
      resolveProjectKey({ workspaceId: workspace?.id ?? "", key: projectKey }),
    enabled: missed && Boolean(projectKey),
    retry: false,
    staleTime: 60_000,
  });
  return {
    project,
    // Used only while the key misses, so renaming a project back never loops.
    currentKey: missed ? (currentKey ?? undefined) : undefined,
    workspaceId: project?.workspaceId ?? workspace?.id ?? "",
    isLoading:
      loadingWorkspace || (enabled && Boolean(workspace) && loadingProjects),
  };
}
