import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IdentityAccessDenied } from "@/components/god-mode/identity-access-denied";
import { ImportRunsPanel } from "@/components/god-mode/imports/import-runs-panel";
import PageTitle from "@/components/page-title";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { parseGodModeImportsSearch, routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/god-mode/imports",
)({
  validateSearch: parseGodModeImportsSearch,
  component: GodModeImportsRoute,
});

function GodModeImportsRoute() {
  const { t } = useTranslation("godModeImports");
  const isAdmin = useInstanceAdminSignal();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { pathname } = useLocation();
  if (pathname.startsWith(`${routes.godModeImports.path}/`)) return <Outlet />;

  return (
    <section className="min-w-0 flex-1 space-y-6 p-5 lg:p-8">
      <PageTitle title={t("title")} />
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          {t("description")}
        </p>
      </header>
      {isAdmin ? (
        <ImportRunsPanel
          workspaceId={search.workspaceId}
          step={search.step}
          onNewImport={() =>
            void navigate({ search: { ...search, step: "connect" } })
          }
          onCloseWizard={() =>
            void navigate({ search: { workspaceId: search.workspaceId } })
          }
          onWorkspaceChange={(workspaceId) =>
            void navigate({
              search: { workspaceId },
            })
          }
          onOpenRun={(id, workspaceId, step) =>
            void navigate({
              to: routes.godModeImportRun.path,
              params: { id },
              search: { workspaceId, ...(step ? { step } : {}) },
            })
          }
        />
      ) : (
        <IdentityAccessDenied />
      )}
    </section>
  );
}
