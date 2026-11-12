import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

/**
 * Whether the viewer may open this project's feature switches: the strict
 * `project:manage_settings` at this project, the capability the Features settings route checks.
 * False until the project and its capabilities resolve, so the action never flashes on.
 */
export function useCanManageProjectFeatures(projectKey: string): boolean {
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  const permission = useWorkspacePermission(
    project ? (project.workspaceId ?? workspace?.id) : undefined,
    project?.id,
  );
  return Boolean(project) && permission.canManageProjectSettings();
}

/** The same check for a screen that already knows the project's id and workspace. */
export function useCanManageProjectFeaturesById(
  projectId: string,
  workspaceId: string,
): boolean {
  const permission = useWorkspacePermission(workspaceId, projectId);
  return permission.canManageProjectSettings();
}
