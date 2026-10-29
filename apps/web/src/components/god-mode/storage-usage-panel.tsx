import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Frame,
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
  getStorageUsage,
  runStorageProbe,
  type StorageProbeResult,
} from "@/fetchers/god-mode/storage-usage";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

function formatBytes(raw: string) {
  let value: number;
  try {
    value = Number(BigInt(raw));
  } catch {
    return raw;
  }
  if (!Number.isFinite(value)) return raw;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function StorageUsagePanel() {
  const { t } = useTranslation("godModeStorage");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["god-mode", "storage-usage"],
    queryFn: getStorageUsage,
    retry: false,
  });
  const probe = useMutation({
    mutationFn: runStorageProbe,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["god-mode", "storage-usage"] }),
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

  const usage = query.data;
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{t("backendTitle")}</CardTitle>
            <Badge
              variant={
                usage.backend.configuration === "configured"
                  ? "success"
                  : "warning"
              }
            >
              {t(`configuration.${usage.backend.configuration}`)}
            </Badge>
          </div>
          <CardDescription>
            {t("checkedAt", { when: formatDateTime(usage.checkedAt) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-muted-foreground text-sm">{t("driver")}</dt>
              <dd className="break-words font-medium">
                {t(`drivers.${usage.backend.driver}`)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-sm">{t("source")}</dt>
              <dd className="font-medium">{t("bootstrap")}</dd>
            </div>
          </dl>
          <Alert variant="info">
            <AlertTitle>{t("connectivityTitle")}</AlertTitle>
            <AlertDescription>{t("connectivityDescription")}</AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={!usage.backend.probeAvailable || probe.isPending}
              onClick={() => probe.mutate()}
            >
              {probe.isPending ? t("probing") : t("runProbe")}
            </Button>
            {probe.isError ? (
              <span className="text-destructive text-sm">
                {t("probeRequestFailed")}
              </span>
            ) : null}
          </div>
          {probe.data ? <ProbeOutcome result={probe.data} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("usageTitle")}</CardTitle>
          <CardDescription>{t("usageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-sm">
                {t("limits.maxAttachmentBytes")}
              </dt>
              <dd className="font-medium">
                {formatBytes(String(usage.limits.maxAttachmentBytes))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">
                {t("limits.maxAttachmentsPerItem")}
              </dt>
              <dd className="font-medium">
                {usage.limits.maxAttachmentsPerItem}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground text-sm">
                {t("limits.allowedExtensions")}
              </dt>
              <dd className="break-words font-medium">
                {usage.limits.allowedExtensions.join(", ")}
              </dd>
            </div>
          </dl>
          <Frame className="min-w-0">
            <Table scrollLabel={t("usageTitle")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.state")}</TableHead>
                  <TableHead>{t("columns.count")}</TableHead>
                  <TableHead>{t("columns.logicalBytes")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["ready", "pending", "deleted"] as const).map((state) => (
                  <TableRow key={state}>
                    <TableCell>{t(`states.${state}`)}</TableCell>
                    <TableCell>{usage.attachments[state].count}</TableCell>
                    <TableCell>
                      {formatBytes(usage.attachments[state].bytes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
          <p className="text-muted-foreground text-sm">
            {t("physicalUsageUnavailable")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProbeOutcome({ result }: { result: StorageProbeResult }) {
  const { t } = useTranslation("godModeStorage");
  return (
    <Alert variant={result.status === "verified" ? "success" : "warning"}>
      <AlertTitle>{t(`probeStatuses.${result.status}`)}</AlertTitle>
      <AlertDescription>
        {t("probeOutcome", {
          cleanup: t(`cleanup.${result.cleanup}`),
          duration: result.durationMs,
        })}
      </AlertDescription>
    </Alert>
  );
}
