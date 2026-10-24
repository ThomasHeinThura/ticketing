import { Navigate } from "@tanstack/react-router";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { LabelCatalogueSearch } from "@/lib/routes";

/**
 * `/agent/*` URLs whose screen already exists in kaneo send the user to that kaneo page
 * (docs/02-design/design-principles.md § Integrate, don't add). These two cover pages
 * whose kaneo URL needs the active workspace or the project's id.
 */
export function WorkspaceMembersRedirect() {
  const { data: workspace, isLoading } = useActiveWorkspace();
  if (!workspace)
    return isLoading ? null : <Navigate to="/dashboard" replace />;
  return (
    <Navigate
      to="/dashboard/workspace/$workspaceId/members"
      params={{ workspaceId: workspace.id }}
      replace
    />
  );
}

export function WorkspaceSearchRedirect() {
  const { data: workspace, isLoading } = useActiveWorkspace();
  if (!workspace)
    return isLoading ? null : <Navigate to="/dashboard" replace />;
  return (
    <Navigate
      to="/dashboard/workspace/$workspaceId/search"
      params={{ workspaceId: workspace.id }}
      replace
    />
  );
}

export function ProjectSettingsRedirect({
  projectKey,
  section,
  search,
}: {
  projectKey: string;
  section:
    | "general"
    | "workflow"
    | "labels"
    | "members"
    | "features"
    | "automations";
  search?: LabelCatalogueSearch;
}) {
  const { data: workspace, isLoading: isWorkspaceLoading } =
    useActiveWorkspace();
  const { data: projects, isLoading } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });
  const project = projects?.find((candidate) => candidate.slug === projectKey);
  if (!project) {
    if (!workspace) {
      return isWorkspaceLoading ? null : <Navigate to="/dashboard" replace />;
    }
    if (isLoading) return null;
    return <Navigate to="/agent" replace />;
  }
  if (section === "labels")
    return (
      <Navigate
        to="/dashboard/settings/projects/$projectId/labels"
        params={{ projectId: project.id }}
        search={search ?? {}}
        replace
      />
    );
  if (section === "members")
    return (
      <Navigate
        to="/dashboard/settings/projects/$projectId/members"
        params={{ projectId: project.id }}
        replace
      />
    );
  if (section === "automations")
    return (
      <Navigate
        to="/dashboard/settings/projects/$projectId/automations"
        params={{ projectId: project.id }}
        replace
      />
    );
  if (section === "features")
    return (
      <Navigate
        to="/dashboard/settings/projects/$projectId/features"
        params={{ projectId: project.id }}
        replace
      />
    );
  return section === "workflow" ? (
    <Navigate
      to="/dashboard/settings/projects/$projectId/workflow"
      params={{ projectId: project.id }}
      replace
    />
  ) : (
    <Navigate
      to="/dashboard/settings/projects/$projectId/general"
      params={{ projectId: project.id }}
      replace
    />
  );
}
