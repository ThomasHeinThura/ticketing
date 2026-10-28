import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  KbdSequence,
  SidebarTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useIsMobile,
} from "@taskdesk/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import TaskCrumbSelect from "@/components/common/header/task-crumb-select";
import Layout from "@/components/common/layout";
import RealtimeUnavailableNotice from "@/components/common/realtime-unavailable-notice";
import { shortcuts } from "@/constants/shortcuts";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";

type TaskLayoutProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  projectName?: string;
  projectSlug?: string;
  taskNumber?: number | null;
  headerActions?: ReactNode;
  children: ReactNode;
  rightSidebar?: ReactNode;
};

export default function TaskLayout({
  taskId,
  projectId,
  workspaceId,
  projectName,
  projectSlug,
  taskNumber,
  headerActions,
  children,
  rightSidebar,
}: TaskLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status: socketStatus } = useProjectWebSocket(projectId);

  const taskLabel =
    projectSlug && taskNumber != null
      ? `${projectSlug}-${taskNumber}`
      : t("tasks:common.selectTask");

  const handleTaskSwitch = (nextTaskId: string) => {
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId, projectId, taskId: nextTaskId },
    });
  };

  return (
    <TaskPageFrame
      header={
        <Layout.Header className="h-11 border-border/80 px-2">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger
                      className="-ml-1 h-7 w-7 cursor-pointer text-foreground hover:text-foreground"
                      toggleLabel={t("common:a11y.toggleSidebar")}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="flex items-center gap-2 text-[10px]">
                      Toggle sidebar
                      <KbdSequence
                        keys={[
                          shortcuts.sidebar.prefix,
                          shortcuts.sidebar.toggle,
                        ]}
                      />
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="h-4 w-px shrink-0 bg-border/80" />

              <div className="min-w-0 items-center gap-1.5 flex">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
                      params: { workspaceId, projectId },
                    })
                  }
                  className="max-w-40 truncate text-left text-xs text-foreground hover:underline"
                >
                  {projectName || t("navigation:sidebar.projects")}
                </Button>
                <span className="text-foreground text-xs">/</span>
                <TaskCrumbSelect
                  projectId={projectId}
                  taskId={taskId}
                  taskLabel={taskLabel}
                  onSelectTask={handleTaskSwitch}
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {headerActions}
            </div>
          </div>
        </Layout.Header>
      }
      notice={<RealtimeUnavailableNotice status={socketStatus} />}
      rightSidebar={rightSidebar}
    >
      {children}
    </TaskPageFrame>
  );
}

/** Kaneo's original task-page frame: desktop Properties starts beside the header. */
export function TaskPageFrame({
  header,
  notice,
  children,
  rightSidebar,
}: {
  header: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
  rightSidebar?: ReactNode;
}) {
  const compact = useIsMobile(1024);
  return (
    <Layout className="flex h-svh max-h-svh min-h-0 flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        {notice}
        <Layout.Content>
          <div className="flex h-full min-h-0 flex-col overflow-hidden lg:flex-row">
            <div className="order-2 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:order-1">
              {children}
            </div>
            <div className="order-1 border-b border-border/80 lg:order-2 lg:hidden">
              {compact ? rightSidebar : null}
            </div>
          </div>
        </Layout.Content>
      </div>
      <div className="hidden min-h-0 shrink-0 border-l border-border/80 bg-card lg:flex lg:h-full lg:overflow-hidden">
        {!compact ? rightSidebar : null}
      </div>
    </Layout>
  );
}
