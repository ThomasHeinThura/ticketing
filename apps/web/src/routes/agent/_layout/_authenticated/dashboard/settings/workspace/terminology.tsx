import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NoAccessPage } from "@/components/common/page-states";
import PageTitle from "@/components/page-title";
import {
  isForbiddenError,
  SettingsAccessGate,
  useSettingsAccess,
} from "@/components/settings/settings-access";
import { TerminologyEditor } from "@/components/settings/terminology-editor";
import { getTerminology } from "@/fetchers/terminology";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/terminology",
)({ component: WorkspaceTerminology });

function WorkspaceTerminology() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const access = useSettingsAccess(
    (permission) => permission.canManageWorkspaceSettings(),
    undefined,
    { refreshOnMount: true },
  );
  const terminology = useQuery({
    queryKey: ["terminology", "workspace", workspace?.id ?? ""],
    queryFn: () =>
      getTerminology({ scope: "workspace", workspaceId: workspace?.id ?? "" }),
    enabled: access === "allowed" && Boolean(workspace?.id),
  });
  if (access !== "allowed")
    return <SettingsAccessGate access={access}>{null}</SettingsAccessGate>;
  if (isForbiddenError(terminology.error)) return <NoAccessPage />;
  return (
    <>
      <PageTitle
        title={t("settings:terminology.title", { defaultValue: "Terminology" })}
      />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:terminology.title", { defaultValue: "Terminology" })}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:terminology.description", {
              defaultValue:
                "Set the visible noun forms used in this instance or workspace.",
            })}
          </p>
        </div>
        <SettingsAccessGate access={access}>
          {workspace ? (
            <TerminologyEditor
              target={{ scope: "workspace", workspaceId: workspace.id }}
            />
          ) : null}
        </SettingsAccessGate>
      </div>
    </>
  );
}
