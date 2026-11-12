import { createFileRoute } from "@tanstack/react-router";
import { Skeleton, useDelayedPending } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { AutomationRulesPanel } from "@/components/automation/automation-rules-panel";
import {
  SettingsAccessDenied,
  SettingsAccessError,
  useSettingsAccess,
} from "@/components/settings/settings-access";
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
  const pending = !workspace || access === "checking";
  const placeholderVisible = useDelayedPending(pending);
  if (
    (access !== "denied" && access !== "error" && pending) ||
    (placeholderVisible && access === "allowed" && workspace)
  )
    return (
      <div
        className="p-6"
        role="status"
        aria-label={t("list.loading")}
        style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
      >
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (access === "denied" || access === "error")
    return (
      <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-y-auto p-6">
        <h1 className="text-2xl font-semibold">{t("workspace.title")}</h1>
        {access === "error" ? (
          <SettingsAccessError />
        ) : (
          <SettingsAccessDenied />
        )}
      </div>
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
