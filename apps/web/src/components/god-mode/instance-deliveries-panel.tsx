import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FramePanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  getInstanceDeliveries,
  type InstanceDeliveryItem,
  requeueInstanceDelivery,
} from "@/fetchers/god-mode/instance-deliveries";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

const KIND_KEYS = {
  event: "events",
  notification: "notifications",
  digest: "digests",
  webhook: "webhooks",
} as const;

function stateVariant(state: string) {
  if (state === "delivered") return "success" as const;
  if (state === "dead") return "error" as const;
  if (state === "pending" || state === "collecting") return "warning" as const;
  return "outline" as const;
}

function lastResult(item: InstanceDeliveryItem, t: (key: string) => string) {
  if (item.kind === "webhook") {
    const details = [
      item.statusCode == null ? null : String(item.statusCode),
      item.durationMs == null ? null : `${item.durationMs} ms`,
    ].filter(Boolean);
    if (details.length > 0) return details.join(" · ");
  }
  if (item.errorPresent) return t("errorDetailsWithheld");
  if (item.deliveredAt) return formatDateTime(item.deliveredAt);
  return t("noResult");
}

export function InstanceDeliveriesPanel() {
  const { t } = useTranslation("godModeDeliveries");
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["god-mode", "deliveries"],
    queryFn: getInstanceDeliveries,
    retry: false,
  });
  const requeue = useMutation({
    mutationFn: requeueInstanceDelivery,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["god-mode", "deliveries"] }),
  });

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
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
        <AlertDescription className="flex items-center justify-between gap-3">
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

  const { counts, items } = query.data;
  const groups = Object.entries(counts) as Array<
    [keyof typeof counts, Record<string, number>]
  >;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map(([group, states]) => (
          <Card key={group}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t(`groups.${group}`)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(states).map(([state, count]) => (
                <span className="text-muted-foreground text-xs" key={state}>
                  {t(`states.${state}`)}:{" "}
                  <span className="font-medium text-foreground">{count}</span>
                </span>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {t("checkedAt", { when: formatDateTime(query.data.checkedAt) })}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      </div>

      {requeue.isError && (
        <Alert variant="error">
          <AlertTitle>{t("requeueErrorTitle")}</AlertTitle>
          <AlertDescription>{t("requeueErrorDescription")}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Frame>
          <FramePanel className="p-8">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("emptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FramePanel>
        </Frame>
      ) : (
        <Frame className="min-w-0">
          <Table scrollLabel={t("title")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.event")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead>{t("columns.channel")}</TableHead>
                <TableHead>{t("columns.attempts")}</TableHead>
                <TableHead>{t("columns.lastResult")}</TableHead>
                <TableHead>{t("columns.created")}</TableHead>
                <TableHead>{t("columns.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={`${item.kind}:${item.id}`}>
                  <TableCell className="font-medium">
                    {t(`kinds.${KIND_KEYS[item.kind]}`)}
                    {item.kind === "digest" && item.cadence
                      ? ` · ${t(`cadences.${item.cadence}`)}`
                      : null}
                    {item.kind === "digest" && item.children != null
                      ? ` · ${t("childCount", { count: item.children })}`
                      : null}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    {item.eventKind ?? t("notApplicable")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={stateVariant(item.state)}>
                      {t(`states.${item.state}`, { defaultValue: item.state })}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.channel ?? t("notApplicable")}</TableCell>
                  <TableCell>{item.attempts ?? t("notApplicable")}</TableCell>
                  <TableCell className="max-w-64 text-muted-foreground text-xs">
                    {lastResult(item, t)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </TableCell>
                  <TableCell>
                    {item.requeueAllowed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={requeue.isPending}
                        onClick={() => requeue.mutate(item.id)}
                      >
                        {requeue.isPending && requeue.variables === item.id
                          ? t("requeuePending")
                          : t("requeue")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}

      <p className="text-muted-foreground text-xs">{t("boundedNotice")}</p>
    </div>
  );
}
