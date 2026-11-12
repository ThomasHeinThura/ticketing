import type { QueryClient } from "@tanstack/react-query";
import { projectsOptions } from "@/hooks/queries/project/use-get-projects";
import { workspacesOptions } from "@/hooks/queries/workspace/use-get-workspaces";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

export async function resolveRouteProject(
  queryClient: QueryClient,
  session: { session?: unknown } | null | undefined,
  projectKey: string,
) {
  const workspaceId = getActiveOrganizationId(session);
  if (!workspaceId) return;
  const [workspaces, projects] = await Promise.all([
    queryClient.ensureQueryData(workspacesOptions()),
    queryClient.ensureQueryData(projectsOptions(workspaceId)),
  ]);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) return;
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  if (project) return { project, workspaceId };
}
