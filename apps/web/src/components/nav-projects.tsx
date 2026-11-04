import { useQuery } from "@tanstack/react-query";
import { useMatch, useNavigate, useParams } from "@tanstack/react-router";
import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@taskdesk/ui";
import {
  ChevronRight,
  Folder,
  Forward,
  MoreHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { ActionTooltip } from "@/components/common/action-tooltip";
import type getProjects from "@/fetchers/project/get-projects";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  getDefaultAgentTerm,
  useAgentTranslation,
} from "@/lib/i18n/agent-translation";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";

// The closed creation form pulls in the icon catalogue and editor controls.
// Load it on creation intent instead of competing with sidebar/palette startup.
const CreateProjectModal = lazy(
  () => import("./shared/modals/create-project-modal"),
);

const SortableProjectList = lazy(() => import("./nav-projects-sortable"));
type ProjectRecord = NonNullable<
  Awaited<ReturnType<typeof getProjects>>
>[number];

/**
 * The project of the work item detail the page loads (same key as `workItemDetailKey`). The
 * sidebar observes that query but never fetches it, and it passes no query function on
 * purpose: TanStack keeps one options object per query, so a `skipToken` here replaced the
 * page's fetcher and its refetch after a version conflict sent nothing. A query without a
 * query function borrows the fetcher of the observer that has one.
 */
export function useCachedWorkItemProjectId(key: string | undefined) {
  const { data } = useQuery<{ projectId?: string } | null>({
    queryKey: ["work-items", "detail", key ?? ""],
    enabled: false,
  });
  return key ? data?.projectId : undefined;
}

export function NavProjects() {
  const { t, i18n } = useAgentTranslation();
  const { isMobile } = useSidebar();
  const { data: workspace } = useActiveWorkspace();
  const { data: projects } = useGetProjects({
    workspaceId: workspace?.id || "",
  });
  const openPendingAction = useOpenPendingAction();
  const { mutateAsync: deleteProject } = useDeleteProject();
  const { canCreateProjects, canDeleteProjects, canUpdateProjects } =
    useWorkspacePermission();
  const canCreate = canCreateProjects();
  const canDeleteProject = canDeleteProjects();
  // Matches the API, which gates /project/reorder on `project: ["update"]`
  // alone — not the create+update+delete bundle.
  const canReorder = canUpdateProjects();
  const navigate = useNavigate();
  const {
    workspaceId: currentWorkspaceId,
    projectId: currentProjectId,
    projectKey: currentProjectKey,
  } = useParams({
    strict: false,
  });

  // A work item page (`/agent/work-items/$key`) carries no project param: its project is
  // the loaded item's, or, before the detail has loaded, the key's prefix (`HELP-8` -> `HELP`;
  // a project key may itself contain hyphens, so only the last segment is the number).
  const workItemMatch = useMatch({
    from: "/_layout/_authenticated/agent/work-items/$key",
    shouldThrow: false,
  });
  const workItemKey = workItemMatch?.params.key;
  const workItemProjectId = useCachedWorkItemProjectId(workItemKey);
  const workItemProjectKey = workItemKey?.match(/^(.+)-\d+$/u)?.[1];

  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  // The in-place approval dialog is the single confirmation (PA-3): no pre-confirm.
  const requestProjectDeletion = async (id: string) => {
    try {
      // Deletion is only requested; the project stays until the requester approves it.
      const pendingAction = await deleteProject({ id });
      await openPendingAction(pendingAction);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:pendingDeletion.requestFailed"),
      );
    }
  };

  const isCurrentProject = (project: ProjectRecord) => {
    if (workItemKey)
      return workItemProjectId
        ? workItemProjectId === project.id
        : workItemProjectKey === project.slug;
    return (
      currentProjectKey === project.slug ||
      (currentProjectId === project.id && currentWorkspaceId === workspace?.id)
    );
  };

  // S3: a project opens on its Overview; the work view is one tab away.
  const handleProjectClick = (project: ProjectRecord) => {
    navigate({
      to: "/agent/projects/$projectKey",
      params: {
        projectKey: project.slug,
      },
    });
  };

  const renderProjectContents = (project: ProjectRecord) => (
    <>
      <SidebarMenuButton
        isActive={isCurrentProject(project)}
        size="default"
        className="h-8 gap-0 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
        onClick={() => handleProjectClick(project)}
      >
        <span>{project.name}</span>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              className="absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground after:-inset-2 after:absolute md:after:hidden peer-data-[size=sm]/menu-button:top-1 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 group-data-[collapsible=icon]:hidden group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0"
            />
          }
        >
          <MoreHorizontal />
          <span className="sr-only">{t("navigation:sidebar.more")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-44 rounded-lg"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem
            className="h-7 items-start cursor-pointer text-sm"
            onClick={() => handleProjectClick(project)}
          >
            <Folder className="text-muted-foreground" />
            <span>{t("navigation:projectList.viewProject")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-7 items-start cursor-pointer text-sm"
            onClick={() => {
              navigator.clipboard.writeText(
                `${window.location.origin}${routes.projectOverview.build({ projectKey: project.slug })}`,
              );
              toast.success(t("navigation:projectList.linkCopied"));
            }}
          >
            <Forward className="text-muted-foreground" />
            <span>{t("navigation:projectList.shareProject")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="h-7 items-start cursor-pointer text-sm"
            onClick={() => {
              navigate({
                to: routes.projectSettingsGeneral.path,
                params: { projectId: project.id },
              });
            }}
          >
            <Settings className="text-muted-foreground" />
            <span>{t("navigation:projectList.projectSettings")}</span>
          </DropdownMenuItem>
          {canDeleteProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="h-7 items-start text-destructive cursor-pointer text-sm"
                onClick={() => void requestProjectDeletion(project.id)}
              >
                <Trash2 className="text-destructive" />
                <span>{t("navigation:projectList.deleteProject")}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  if (!workspace) return null;

  return (
    <>
      <Collapsible defaultOpen className="group/collapsible">
        <SidebarGroup className="group-data-[collapsible=icon]:hidden gap-1 p-2 pt-1">
          <ActionTooltip label={getDefaultAgentTerm(i18n, "project", 2)}>
            <CollapsibleTrigger
              className="data-panel-open:[&_svg]:rotate-90"
              render={
                <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
              }
            >
              <span>{t("navigation:sidebar.projects")}</span>
              <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground transition-transform duration-200" />
            </CollapsibleTrigger>
          </ActionTooltip>
          <CollapsiblePanel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {canReorder ? (
                  <Suspense
                    fallback={projects?.map((project) => (
                      <SidebarMenuItem key={project.id}>
                        {renderProjectContents(project)}
                      </SidebarMenuItem>
                    ))}
                  >
                    <SortableProjectList
                      projects={projects ?? []}
                      workspaceId={workspace.id}
                      renderProjectContents={renderProjectContents}
                    />
                  </Suspense>
                ) : (
                  projects?.map((project) => (
                    <SidebarMenuItem key={project.id}>
                      {renderProjectContents(project)}
                    </SidebarMenuItem>
                  ))
                )}

                {canCreate && (
                  <SidebarMenuItem className="mt-1">
                    <SidebarMenuButton
                      size="default"
                      className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                      onClick={() => setIsCreateProjectModalOpen(true)}
                    >
                      <span>{t("navigation:projectList.addProject")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsiblePanel>
        </SidebarGroup>
      </Collapsible>

      {isCreateProjectModalOpen ? (
        <Suspense fallback={null}>
          <CreateProjectModal
            open
            onClose={() => setIsCreateProjectModalOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
