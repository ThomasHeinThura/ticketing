import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** The canonical `/agent/projects/{key}` project, found in the active workspace's projects. */
export default function useProjectByKey(projectKey: string) {
  const { data: workspace, isLoading: loadingWorkspace } = useActiveWorkspace();
  const { data: projects, isLoading: loadingProjects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  return {
    project,
    workspaceId: project?.workspaceId ?? workspace?.id ?? "",
    isLoading: loadingWorkspace || (Boolean(workspace) && loadingProjects),
  };
}
