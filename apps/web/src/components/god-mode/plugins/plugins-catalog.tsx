import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  LoadingStatus,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  listSupportedPlugins,
  type SupportedPlugin,
} from "@/fetchers/god-mode/plugins";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { SecretsRotationPanel } from "./secrets-rotation-panel";

function badgeVariantForState(
  state: SupportedPlugin["state"],
): "success" | "destructive" | "outline" {
  if (state === "enabled") return "success";
  if (state === "invalid") return "destructive";
  return "outline";
}

export function PluginsCatalog() {
  const { t } = useTranslation("godModePlugins");
  const query = useQuery({
    queryKey: ["god-mode", "plugins"],
    queryFn: listSupportedPlugins,
    retry: false,
    throwOnError: false,
  });

  const queryPlaceholderVisible = useDelayedPending(query.isPending, {
    releaseNow: query.isSuccess && query.data.plugins.length === 0,
  });
  if (
    !query.isError &&
    (query.isPending || (queryPlaceholderVisible && query.data))
  )
    return (
      <LoadingStatus
        visible={queryPlaceholderVisible}
        label={t("common:empty.loading")}
      >
        <Skeleton
          className="h-40 w-full"
          style={{ visibility: queryPlaceholderVisible ? "visible" : "hidden" }}
        />
      </LoadingStatus>
    );
  if (query.error instanceof HttpError && query.error.status === 403)
    return (
      <Alert variant="info">
        <AlertTitle>{t("forbiddenTitle")}</AlertTitle>
        <AlertDescription>{t("forbiddenDescription")}</AlertDescription>
      </Alert>
    );
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("loadErrorTitle")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{t("loadErrorDescription")}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );

  const activeCount = query.data.plugins.filter(
    (plugin) => plugin.state === "enabled",
  ).length;

  return (
    <div className="min-w-0 space-y-4">
      <SecretsRotationPanel />
      <Alert variant="info">
        <AlertTitle className="flex flex-wrap items-center gap-2">
          <span>{t("subprocessorsTitle")}</span>
          <Badge variant={activeCount > 0 ? "warning" : "secondary"}>
            {t("subprocessorsActiveCount", { count: activeCount })}
          </Badge>
        </AlertTitle>
        <AlertDescription>{t("subprocessorsDescription")}</AlertDescription>
      </Alert>
      <p className="text-muted-foreground text-sm">
        {t("checkedAt", { when: formatDateTime(query.data.checkedAt) })}
      </p>
      {query.data.plugins.map((plugin) => {
        const settingsPath =
          plugin.configPath ??
          routes.notificationProvider?.path ??
          "/god-mode/notifications";
        return (
          <Card key={plugin.id} className="min-w-0">
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div className="min-w-0 space-y-1">
                <CardTitle>{plugin.name}</CardTitle>
                <CardDescription>{t(`kinds.${plugin.kind}`)}</CardDescription>
              </div>
              <Badge variant={badgeVariantForState(plugin.state)}>
                {t(`states.${plugin.state}`)}
              </Badge>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 space-y-1 text-sm">
                <p className="text-muted-foreground">
                  {t("source", { source: t(`sources.${plugin.source}`) })}
                </p>
                {plugin.destinationSummary ? (
                  <p className="text-muted-foreground">
                    {t("destination", { value: plugin.destinationSummary })}
                  </p>
                ) : null}
                {plugin.dataProcessed ? (
                  <p className="text-muted-foreground">
                    {t("dataProcessed", { value: plugin.dataProcessed })}
                  </p>
                ) : null}
                <p className="text-muted-foreground">
                  {plugin.kind === "notification"
                    ? plugin.credentialConfigured
                      ? t("credentialConfigured")
                      : t("credentialNotConfigured")
                    : plugin.credentialConfigured
                      ? t("subprocessorCredentialConfigured")
                      : t("subprocessorCredentialNotConfigured")}
                </p>
                {plugin.kind === "notification" ? (
                  <p className="text-muted-foreground">
                    {t("healthNotRecorded")}
                  </p>
                ) : null}
              </div>
              <Button render={<Link to={settingsPath} />} variant="outline">
                {t("manageSettings")}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
