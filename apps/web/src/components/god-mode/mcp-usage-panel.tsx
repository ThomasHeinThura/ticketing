import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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
import { getMcpUsage } from "@/fetchers/god-mode/mcp-usage";
import { formatDateTime } from "@/lib/format";
import { HttpError } from "@/lib/http-error";

export function McpUsagePanel() {
  const { t, i18n } = useTranslation("godModeMcpUsage");
  const percent = new Intl.NumberFormat(i18n?.resolvedLanguage || "en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const duration = new Intl.NumberFormat(i18n?.resolvedLanguage || "en-US", {
    maximumFractionDigits: 1,
  });
  const query = useQuery({
    queryKey: ["god-mode", "mcp-usage"],
    queryFn: getMcpUsage,
    retry: false,
  });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
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
        <AlertDescription>{t("loadErrorDescription")}</AlertDescription>
      </Alert>
    );

  const { keys } = query.data;
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-muted-foreground text-sm">
        {t("period", {
          start: formatDateTime(query.data.periodStart),
          end: formatDateTime(query.data.periodEnd),
        })}
      </p>
      <Alert variant="info">
        <AlertTitle>{t("metricsLimitTitle")}</AlertTitle>
        <AlertDescription>{t("metricsLimitDescription")}</AlertDescription>
      </Alert>
      {keys.length === 0 ? (
        <Frame>
          <div className="p-8">
            <p className="text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          </div>
        </Frame>
      ) : (
        <Frame className="min-w-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.key")}</TableHead>
                <TableHead>{t("columns.state")}</TableHead>
                <TableHead>{t("columns.recordedRequests")}</TableHead>
                <TableHead>{t("columns.lastRecorded")}</TableHead>
                <TableHead>{t("columns.autoDisabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="min-w-40">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="break-words font-medium">
                        {key.name || t("unnamedKey")}
                      </span>
                      {key.prefix ? (
                        <code className="text-xs text-muted-foreground">
                          {key.prefix}…
                        </code>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={key.enabled ? "success" : "outline"}>
                      {key.enabled ? t("enabled") : t("disabled")}
                    </Badge>
                  </TableCell>
                  <TableCell>{key.recordedRequestCount}</TableCell>
                  <TableCell>
                    {key.lastRecordedAt
                      ? formatDateTime(key.lastRecordedAt)
                      : t("notRecorded")}
                  </TableCell>
                  <TableCell>
                    {key.autoDisabledAt
                      ? formatDateTime(key.autoDisabledAt)
                      : t("notAutoDisabled")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}
      {keys.length > 0 ? (
        <section
          className="min-w-0 space-y-2"
          aria-labelledby="mcp-client-tools-title"
        >
          <h2 id="mcp-client-tools-title" className="font-semibold text-base">
            {t("toolsTitle")}
          </h2>
          <Accordion multiple>
            {keys.map((key) => (
              <AccordionItem key={key.id} value={key.id}>
                <AccordionTrigger className="min-w-0">
                  <span className="min-w-0 break-words">
                    {key.name || t("unnamedKey")}
                  </span>
                </AccordionTrigger>
                <AccordionPanel>
                  {key.clientReportedTools.length === 0 ? (
                    <p>{t("toolsEmpty")}</p>
                  ) : (
                    <Frame className="min-w-0 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {(
                              [
                                "tool",
                                "calls",
                                "errors",
                                "errorRate",
                                "meanDuration",
                                "maxDuration",
                                "lastReported",
                              ] as const
                            ).map((column) => (
                              <TableHead key={column}>
                                {t(`toolColumns.${column}`)}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {key.clientReportedTools.map((tool) => (
                            <TableRow key={tool.toolName}>
                              <TableCell>
                                <code>{tool.toolName}</code>
                              </TableCell>
                              <TableCell>{tool.callCount}</TableCell>
                              <TableCell>{tool.errorCount}</TableCell>
                              <TableCell>
                                {percent.format(tool.errorRate)}
                              </TableCell>
                              <TableCell>
                                {duration.format(tool.meanDurationMs)}
                              </TableCell>
                              <TableCell>
                                {duration.format(tool.maxDurationMs)}
                              </TableCell>
                              <TableCell>
                                {formatDateTime(tool.lastReportedAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Frame>
                  )}
                </AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ) : null}
      {query.data.hasMore ? (
        <p className="text-muted-foreground text-sm">{t("boundedList")}</p>
      ) : null}
    </div>
  );
}
