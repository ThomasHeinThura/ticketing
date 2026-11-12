import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/**
 * The canonical `/agent/projects/{key}` project, found in the active workspace's projects.
 * `enabled: false` reads nothing (for a caller that only sometimes has a project key).
 */
export default function useProjectByKey(projectKey: string, enabled = true) {
  const { data: workspace, isLoading: loadingWorkspace } = useActiveWorkspace();
  const { data: projects, isLoading: loadingProjects } = useGetProjects(
    { workspaceId: workspace?.id ?? "" },
    enabled,
  );
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  return {
    project,
    workspaceId: project?.workspaceId ?? workspace?.id ?? "",
    isLoading:
      loadingWorkspace || (enabled && Boolean(workspace) && loadingProjects),
  };
}
