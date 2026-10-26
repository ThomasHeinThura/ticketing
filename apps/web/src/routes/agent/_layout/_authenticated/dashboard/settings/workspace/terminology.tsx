import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { TerminologyEditor } from "@/components/settings/terminology-editor";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/terminology",
)({ component: WorkspaceTerminology });

function WorkspaceTerminology() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  if (!workspace) return null;
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
        <TerminologyEditor
          target={{ scope: "workspace", workspaceId: workspace.id }}
        />
      </div>
    </>
  );
}
