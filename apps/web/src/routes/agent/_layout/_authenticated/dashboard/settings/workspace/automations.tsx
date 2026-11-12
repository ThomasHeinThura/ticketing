import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AutomationRulesPanel } from "@/components/automation/automation-rules-panel";
import { useSettingsAccess } from "@/components/settings/settings-access";
import { SettingsAccessPage } from "@/components/settings/settings-access-page";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/automations",
)({
  component: WorkspaceAutomationsRoute,
});

/** Workspace automations (`/dashboard/settings/workspace/automations`): rules with `project_id` null. */
function WorkspaceAutomationsRoute() {
  const { t } = useTranslation("automations");
  const { data: workspace } = useActiveWorkspace();
  // `GET /api/workspaces/{id}/automations` needs `workspace:manage_settings`, so every role that can
  // read the rules can also manage them. Any other role (reached by URL only) gets the one access
  // notice and the panel never sends the request the server would refuse.
  const access = useSettingsAccess((permission) =>
    permission.canManageWorkspaceSettings(),
  );
  if (access !== "allowed")
    return (
      <SettingsAccessPage
        access={access}
        titleKey="automations:workspace.title"
        descriptionKey="automations:workspace.description"
      />
    );
  if (!workspace) return null;
  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-y-auto p-6">
      <AutomationRulesPanel
        scope={{ kind: "workspace", workspaceId: workspace.id }}
        workspaceId={workspace.id}
        projectId={null}
        canManage
        title={t("workspace.title")}
        description={t("workspace.description")}
      />
    </div>
  );
}
