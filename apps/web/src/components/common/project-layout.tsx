import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayoutControlsFallback from "@/components/common/header/project-layout-controls-fallback";
import WorkspaceCrumbSelect from "@/components/common/header/workspace-crumb-select";
import Layout from "@/components/common/layout";
import SidebarToggle from "@/components/common/sidebar-toggle";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { afterPrimaryContent } from "@/lib/after-primary-content";

const CanonicalProjectRealtime = lazy(
  () => import("@/components/common/canonical-project-realtime"),
);
const LegacyProjectRealtime = lazy(
  () => import("@/components/common/legacy-project-realtime"),
);
// The header "…" menu pulls in the menu primitives, which the work-list route graph does not
// otherwise need (G11), so it loads with the deferred project controls.
const ProjectHeaderMenu = lazy(
  () => import("@/components/common/header/project-header-menu"),
);
const CreateProjectModal = lazy(
  () => import("@/components/shared/modals/create-project-modal"),
);
const loadProjectLayoutControls = () =>
  import("@/components/common/header/project-layout-controls");
const ProjectLayoutControls = lazy(loadProjectLayoutControls);
let projectLayoutControlsReady = false;

type ProjectLayoutProps = {
  projectId: string;
  workspaceId: string;
  headerActions?: ReactNode;
  children: ReactNode;
  showViewSwitcher?: boolean;
  activeView?:
    | "overview"
    | "backlog"
    | "board"
    | "calendar"
    | "gantt"
    | "cycles"
    | "modules"
    | "pages"
    | "prerequisites"
    | "team"
    | "documents";
  realtimeMode?: "legacy" | "canonical" | "page";
};

export default function ProjectLayout({
  projectId,
  workspaceId,
  headerActions,
  children,
  showViewSwitcher = true,
  activeView,
  realtimeMode = "legacy",
}: ProjectLayoutProps) {
  const { t } = useTranslation();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const [showProjectLayoutControls, setShowProjectLayoutControls] = useState(
    projectLayoutControlsReady,
  );

  // Keep the synchronous Kaneo shell usable, then fetch the larger project controls
  // after the primary content has rendered. The fixed header keeps its geometry.
  useEffect(() => {
    if (projectLayoutControlsReady) return;
    const abort = new AbortController();
    afterPrimaryContent({
      signal: abort.signal,
      onPrimaryContentReady: () => {
        void loadProjectLayoutControls().catch(() => {});
      },
    }).then(
      () => {
        if (abort.signal.aborted) return;
        projectLayoutControlsReady = true;
        setShowProjectLayoutControls(true);
      },
      () => {},
    );
    return () => abort.abort();
  }, []);

  const projectLayoutViewLabels = [
    t("navigation:projectViews.overview"),
    t("navigation:projectViews.backlog"),
    t("navigation:projectViews.workItems"),
    t("navigation:projectViews.calendar"),
    t("navigation:projectViews.timeline"),
  ];

  return (
    <Layout>
      <Layout.Header className="h-11 border-border/80 px-2">
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarToggle />
            <div className="h-4 w-px shrink-0 bg-border/80" />
            <div className="hidden min-w-0 shrink items-center gap-1 md:flex">
              <WorkspaceCrumbSelect />
              <span className="text-foreground text-xs">/</span>
            </div>
            {showProjectLayoutControls ? (
              <Suspense
                fallback={
                  <ProjectLayoutControlsFallback
                    projectName={project?.name}
                    showViewSwitcher={showViewSwitcher}
                    viewLabels={projectLayoutViewLabels}
                  />
                }
              >
                <ProjectLayoutControls
                  projectId={projectId}
                  workspaceId={workspaceId}
                  projectName={project?.name}
                  projectSlug={project?.slug}
                  showViewSwitcher={showViewSwitcher}
                  activeView={activeView}
                  onAddProject={() => setIsCreateProjectModalOpen(true)}
                />
              </Suspense>
            ) : (
              <ProjectLayoutControlsFallback
                projectName={project?.name}
                showViewSwitcher={showViewSwitcher}
                viewLabels={projectLayoutViewLabels}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            {/* A same-size placeholder keeps the header's geometry while the project and the
                menu load. Phones use the mobile project menu's Project settings instead. */}
            <span className="hidden size-7 shrink-0 md:flex">
              {projectId && showProjectLayoutControls ? (
                <Suspense fallback={null}>
                  <ProjectHeaderMenu
                    projectId={projectId}
                    projectName={project?.name}
                  />
                </Suspense>
              ) : null}
            </span>
          </div>
        </div>
      </Layout.Header>

      {realtimeMode === "canonical" ? (
        <Suspense fallback={null}>
          <CanonicalProjectRealtime projectId={projectId} />
        </Suspense>
      ) : realtimeMode === "legacy" ? (
        <Suspense fallback={null}>
          <LegacyProjectRealtime projectId={projectId} />
        </Suspense>
      ) : null}
      <Layout.Content>{children}</Layout.Content>

      {isCreateProjectModalOpen ? (
        <Suspense fallback={null}>
          <CreateProjectModal
            open={isCreateProjectModalOpen}
            onClose={() => setIsCreateProjectModalOpen(false)}
          />
        </Suspense>
      ) : null}
    </Layout>
  );
}
