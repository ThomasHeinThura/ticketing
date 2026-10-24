import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { AutomationRulesPanel } from "@/components/automation/automation-rules-panel";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/automations",
)({
  component: WorkspaceAutomationsRoute,
});

/** Workspace automations (`/agent/settings/automations`): rules with `project_id` null. */
function WorkspaceAutomationsRoute() {
  const { t } = useTranslation("automations");
  const { workspace, canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission();
  if (!workspace || isCheckingPermissions)
    return (
      <div className="p-6" role="status" aria-label={t("list.loading")}>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-y-auto p-6">
      <AutomationRulesPanel
        scope={{ kind: "workspace", workspaceId: workspace.id }}
        workspaceId={workspace.id}
        projectId={null}
        canManage={canManageWorkspaceSettings()}
        title={t("workspace.title")}
        description={t("workspace.description")}
      />
    </div>
  );
}
