import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { ImportRunDetailPanel } from "@/components/god-mode/imports/import-run-detail-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { parseGodModeImportsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/imports/$id",
)({
  validateSearch: parseGodModeImportsSearch,
  component: GodModeImportRunRoute,
});

function GodModeImportRunRoute() {
  const { t } = useTranslation("godModeImports");
  const isAdmin = useInstanceAdminSignal();
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("detailTitle")} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
          <p className="max-w-3xl text-muted-foreground text-sm">
            {t("detailDescription")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            void navigate({ to: routes.godModeImports.path, search })
          }
        >
          {t("backToHistory")}
        </Button>
      </header>
      {isAdmin ? (
        <ImportRunDetailPanel
          runId={id}
          step={search.step}
          onStepChange={(step) =>
            void navigate({ search: { ...search, step }, replace: true })
          }
          onWorkspaceResolved={(workspaceId) => {
            if (search.workspaceId !== workspaceId)
              void navigate({
                search: { ...search, workspaceId },
                replace: true,
              });
          }}
        />
      ) : (
        <IdentityAccessDenied />
      )}
    </section>
  );
}
