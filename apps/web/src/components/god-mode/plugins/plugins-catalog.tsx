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
  Skeleton,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import { listSupportedPlugins } from "@/fetchers/god-mode/plugins";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";
import { SecretsRotationPanel } from "./secrets-rotation-panel";

export function PluginsCatalog() {
  const { t } = useTranslation("godModePlugins");
  const query = useQuery({
    queryKey: ["god-mode", "plugins"],
    queryFn: listSupportedPlugins,
    retry: false,
    throwOnError: false,
  });

  if (query.isPending) return <Skeleton className="h-40 w-full" />;
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

  return (
    <div className="min-w-0 space-y-4">
      <SecretsRotationPanel />
      <p className="text-muted-foreground text-sm">
        {t("checkedAt", { when: formatDateTime(query.data.checkedAt) })}
      </p>
      {query.data.plugins.map((plugin) => (
        <Card key={plugin.id} className="min-w-0">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="min-w-0 space-y-1">
              <CardTitle>{plugin.name}</CardTitle>
              <CardDescription>{t(`kinds.${plugin.kind}`)}</CardDescription>
            </div>
            <Badge variant={plugin.state === "enabled" ? "success" : "outline"}>
              {t(`states.${plugin.state}`)}
            </Badge>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="text-muted-foreground">
                {t("source", { source: t(`sources.${plugin.source}`) })}
              </p>
              <p className="text-muted-foreground">
                {plugin.credentialConfigured
                  ? t("credentialConfigured")
                  : t("credentialNotConfigured")}
              </p>
              <p className="text-muted-foreground">{t("healthNotRecorded")}</p>
            </div>
            <Button
              render={<Link to={routes.notificationProvider.path} />}
              variant="outline"
            >
              {t("manageSettings")}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
