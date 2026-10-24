import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFrame,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { listWebhooks, type Webhook } from "@/fetchers/webhook/webhooks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatRelativeTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { healthVariant } from "./webhook-model";

function WebhookCard({ webhook }: { webhook: Webhook }) {
  const { t } = useTranslation("webhooks");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            className="truncate rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={routes.webhookEditor.path}
            params={{ id: webhook.id }}
          >
            {webhook.name}
          </Link>
          <Badge variant={healthVariant(webhook.health)}>
            {t(`health.${webhook.health}`)}
          </Badge>
        </CardTitle>
        <CardDescription className="break-all">{webhook.url}</CardDescription>
        <CardAction className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums">
            {t("list.eventCount", { total: webhook.events.length })}
          </div>
          <p className="text-xs text-muted-foreground">
            {webhook.lastDeliveryAt
              ? t("list.lastDelivery", {
                  when: formatRelativeTime(webhook.lastDeliveryAt),
                  status:
                    webhook.lastDeliveryStatusCode ?? t("list.noResponse"),
                })
              : t("list.neverDelivered")}
          </p>
        </CardAction>
      </CardHeader>
      {webhook.lastError ? (
        <CardContent className="pt-0">
          <p className="text-xs text-destructive-foreground">
            {t("list.lastError", { error: webhook.lastError })}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** `/agent/settings/webhooks`: the workspace's outbound webhooks with a health indicator. */
export function WebhookList() {
  const { t } = useTranslation("webhooks");
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canManageWebhooks, isCheckingPermissions } = useWorkspacePermission();
  const canManage = canManageWebhooks();
  const query = useQuery({
    queryKey: ["webhooks", workspace?.id ?? ""],
    enabled: Boolean(workspace?.id && canManage),
    queryFn: () => listWebhooks(workspace?.id ?? ""),
  });
  const loading =
    workspaceLoading || isCheckingPermissions || (canManage && query.isLoading);
  const webhooks = query.data ?? [];

  return (
    <>
      <PageTitle title={t("list.title")} />
      <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{t("list.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("list.description")}
            </p>
          </div>
          {canManage && !loading ? (
            <Button
              render={
                <Link to={routes.webhookEditor.path} params={{ id: "new" }} />
              }
            >
              <Plus aria-hidden="true" />
              {t("list.new")}
            </Button>
          ) : null}
        </div>
        {!canManage && !loading ? (
          <Alert variant="info">
            <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
            <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div
            role="status"
            aria-label={t("list.loading")}
            className="space-y-3"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="error">
            <AlertTitle>{t("list.loadErrorTitle")}</AlertTitle>
            <AlertDescription>
              {t("list.loadErrorDescription")}
              <Button className="w-fit" onClick={() => void query.refetch()}>
                <RefreshCw aria-hidden="true" />
                {t("list.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : webhooks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("list.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("list.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            {canManage ? (
              <Button
                render={
                  <Link to={routes.webhookEditor.path} params={{ id: "new" }} />
                }
              >
                <Plus aria-hidden="true" />
                {t("list.create")}
              </Button>
            ) : null}
          </Empty>
        ) : (
          <CardFrame>
            {webhooks.map((webhook) => (
              <WebhookCard key={webhook.id} webhook={webhook} />
            ))}
          </CardFrame>
        )}
      </div>
    </>
  );
}
