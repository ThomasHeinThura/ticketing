import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { useRequestTypes } from "@/hooks/queries/request-type/use-request-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { routes } from "@/lib/routes";

export const Route = createFileRoute(
  "/_layout/_authenticated/agent/settings/request-types",
)({ component: RequestTypesRoute });

function RequestTypesRoute() {
  const { t } = useTranslation("requestTypes");
  const location = useLocation();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { data, isLoading, isError, refetch } = useRequestTypes(
    workspace?.id ?? "",
  );
  const { canManageRequestTypes, isCheckingPermissions } =
    useWorkspacePermission(workspace?.id ?? null);
  const canManage = canManageRequestTypes();

  if (location.pathname.startsWith(`${routes.requestTypes.path}/`))
    return <Outlet />;

  return (
    <>
      <PageTitle title={t("title")} />
      <main className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
          {canManage && !isCheckingPermissions ? (
            <Button
              render={
                <Link
                  to={routes.requestTypeEditor.path}
                  params={{ id: "new" }}
                />
              }
              disabled={!workspace}
            >
              <Plus aria-hidden="true" />
              {t("create")}
            </Button>
          ) : null}
        </div>
        {!canManage && !isCheckingPermissions ? (
          <Alert variant="info">
            <AlertTitle>{t("title")}</AlertTitle>
            <AlertDescription>{t("readOnly")}</AlertDescription>
          </Alert>
        ) : null}
        {workspaceLoading || isLoading ? (
          <div role="status" aria-label={t("loading")} className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="error">
            <AlertTitle>{t("loadError")}</AlertTitle>
            <AlertDescription>
              <Button variant="outline" onClick={() => void refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : data?.items.length ? (
          <section aria-label={t("title")} className="grid gap-3">
            {data.items.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-1">
                    <h2 className="font-medium">{item.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {item.description || item.group}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={item.published ? "default" : "outline"}>
                      {item.published ? t("published") : t("draft")}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {item.customerVisible ? t("visible") : t("hidden")}
                    </span>
                    <Button
                      variant="outline"
                      render={
                        <Link
                          to={routes.requestTypeEditor.path}
                          params={{ id: item.id }}
                        />
                      }
                    >
                      {t("edit")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("empty")}</EmptyTitle>
                  <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
                </EmptyHeader>
                {canManage && !isCheckingPermissions ? (
                  <Button
                    render={
                      <Link
                        to={routes.requestTypeEditor.path}
                        params={{ id: "new" }}
                      />
                    }
                  >
                    <Plus aria-hidden="true" />
                    {t("create")}
                  </Button>
                ) : null}
              </Empty>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  );
}
