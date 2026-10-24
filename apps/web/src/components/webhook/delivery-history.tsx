import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@taskdesk/ui";
import { ArrowLeft, ChevronRight, RefreshCw, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  listWebhookDeliveries,
  redeliverWebhookDelivery,
  type WebhookDelivery,
} from "@/fetchers/webhook/webhooks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { toast } from "@/lib/toast";
import { deliveryVariant, formatPayload } from "./webhook-model";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function PayloadBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

function DeliveryCard({
  delivery,
  onRedeliver,
  redelivering,
}: {
  delivery: WebhookDelivery;
  onRedeliver: (delivery: WebhookDelivery) => void;
  redelivering: boolean;
}) {
  const { t } = useTranslation("webhooks");
  const body = formatPayload(delivery.requestBody);
  const response = delivery.responseBody ?? "";
  const canRedeliver =
    delivery.requestBody !== null && delivery.requestBody !== undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{delivery.eventKind}</span>
          <Badge variant={deliveryVariant(delivery)}>
            {t(`deliveries.states.${delivery.state}`, {
              defaultValue: delivery.state,
            })}
          </Badge>
          {delivery.source !== "event" ? (
            <Badge variant="outline">
              {t(`deliveries.sources.${delivery.source}`)}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t("deliveries.summary", {
            when: formatDateTime(delivery.attemptedAt ?? delivery.createdAt),
            status: delivery.statusCode ?? t("deliveries.noResponse"),
            duration: delivery.durationMs ?? 0,
            attempt: delivery.attempt,
          })}
          {delivery.error ? ` ${delivery.error}` : ""}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={!canRedeliver || redelivering}
            onClick={() => onRedeliver(delivery)}
          >
            <RotateCw aria-hidden="true" />
            {t("deliveries.redeliver")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-0">
        {delivery.bodyRedacted ? (
          <p className="text-xs text-muted-foreground">
            {t("deliveries.redacted")}
          </p>
        ) : body || response ? (
          <Collapsible>
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="-ms-2" />}
              className="data-panel-open:[&_svg]:rotate-90"
            >
              <ChevronRight
                aria-hidden="true"
                className="transition-transform duration-200"
              />
              {t("deliveries.inspect")}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-3 pt-2">
                {body ? (
                  <PayloadBlock label={t("deliveries.request")} value={body} />
                ) : null}
                {response ? (
                  <PayloadBlock
                    label={t("deliveries.response")}
                    value={response}
                  />
                ) : null}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("deliveries.noPayload")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * `WH-6` / `WH-8`: the delivery history of one webhook, with payload inspection and manual
 * redelivery. A body the reader cannot reach is redacted by the API, never by this screen.
 */
export function DeliveryHistory({ webhookId }: { webhookId: string }) {
  const { t } = useTranslation("webhooks");
  const cache = useQueryClient();
  const { data: workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const { canManageWebhooks, isCheckingPermissions } = useWorkspacePermission();
  const canManage = canManageWebhooks();
  const query = useInfiniteQuery({
    queryKey: ["webhook-deliveries", webhookId],
    enabled: Boolean(workspace?.id && canManage),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listWebhookDeliveries(webhookId, { before: pageParam, limit: 25 }),
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextBefore ?? undefined) : undefined,
  });
  const redeliver = useMutation({
    mutationFn: (delivery: WebhookDelivery) =>
      redeliverWebhookDelivery(delivery.id),
    onSuccess: async (result) => {
      toast[result.state === "delivered" ? "success" : "error"](
        result.state === "delivered"
          ? t("deliveries.redelivered")
          : t("deliveries.redeliveryFailed"),
      );
      await cache.invalidateQueries({
        queryKey: ["webhook-deliveries", webhookId],
      });
    },
    onError: (error) =>
      toast.error(errorText(error, t("deliveries.redeliveryFailed"))),
  });

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const loading = workspaceLoading || isCheckingPermissions || query.isLoading;

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-6 overflow-y-auto p-6">
      <PageTitle title={t("deliveries.title")} />
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2 w-fit"
          render={
            <Link to={routes.webhookEditor.path} params={{ id: webhookId }} />
          }
        >
          <ArrowLeft aria-hidden="true" />
          {t("deliveries.back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("deliveries.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("deliveries.description")}
        </p>
      </div>
      {!canManage && !loading ? (
        <Alert variant="info">
          <AlertTitle>{t("list.readOnlyTitle")}</AlertTitle>
          <AlertDescription>{t("list.readOnlyDescription")}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div
          role="status"
          aria-label={t("deliveries.loading")}
          className="space-y-3"
        >
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("deliveries.loadErrorTitle")}</AlertTitle>
          <AlertDescription>
            {errorText(query.error, t("deliveries.loadErrorDescription"))}
            <Button className="w-fit" onClick={() => void query.refetch()}>
              <RefreshCw aria-hidden="true" />
              {t("list.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("deliveries.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("deliveries.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <CardFrame>
            {rows.map((delivery) => (
              <DeliveryCard
                key={delivery.id}
                delivery={delivery}
                redelivering={redeliver.isPending}
                onRedeliver={(target) => redeliver.mutate(target)}
              />
            ))}
          </CardFrame>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("deliveries.loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
