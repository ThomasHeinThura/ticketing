import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import type { CustomQueryInput, DrillItem } from "@/fetchers/report";
import {
  useCustomItems,
  useReportItems,
  useWidgetItems,
} from "@/hooks/queries/report";
import type { ReportSearch } from "@/lib/report-search";
import { formatValue } from "./report-format";

const linkClass =
  "rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function WorkItemRows({ items }: { items: DrillItem[] }) {
  const { t } = useTranslation();
  return (
    <Table aria-label={t("reports:drill.title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reports:drill.key")}</TableHead>
          <TableHead>{t("reports:drill.itemTitle")}</TableHead>
          <TableHead>{t("reports:drill.state")}</TableHead>
          <TableHead>{t("reports:drill.priority")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="whitespace-nowrap">
              <Link
                to="/agent/work-items/$key"
                params={{ key: item.key }}
                className={linkClass}
              >
                {item.key}
              </Link>
            </TableCell>
            <TableCell className="max-w-72 truncate">{item.title}</TableCell>
            <TableCell>{item.state ?? "—"}</TableCell>
            <TableCell>
              {item.priority
                ? t(`reports:priorities.${item.priority}`, {
                    defaultValue: item.priority,
                  })
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Time entries behind a number: hours only, never a rate. */
function TimeEntryRows({ items }: { items: DrillItem[] }) {
  const { t } = useTranslation();
  return (
    <Table aria-label={t("reports:drill.title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reports:drill.date")}</TableHead>
          <TableHead>{t("reports:drill.person")}</TableHead>
          <TableHead>{t("reports:drill.project")}</TableHead>
          <TableHead>{t("reports:drill.workItem")}</TableHead>
          <TableHead>{t("reports:drill.note")}</TableHead>
          <TableHead className="text-right">
            {t("reports:drill.hours")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="whitespace-nowrap">
              {item.date ?? "—"}
            </TableCell>
            <TableCell>{item.person ?? "—"}</TableCell>
            <TableCell>{item.projectKey ?? "—"}</TableCell>
            <TableCell className="whitespace-nowrap">
              {item.workItemKey ? (
                <Link
                  to="/agent/work-items/$key"
                  params={{ key: item.workItemKey }}
                  className={linkClass}
                >
                  {item.workItemKey}
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="max-w-64 truncate">{item.title}</TableCell>
            <TableCell className="text-right tabular-nums">
              {item.hours == null ? "—" : formatValue(item.hours, "hours")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Cost entries show their recorded description and currency, never the captured rate or amount. */
function CostEntryRows({ items }: { items: DrillItem[] }) {
  const { t } = useTranslation();
  return (
    <Table aria-label={t("reports:drill.title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reports:drill.date")}</TableHead>
          <TableHead>{t("reports:drill.person")}</TableHead>
          <TableHead>{t("reports:drill.project")}</TableHead>
          <TableHead>{t("reports:drill.workItem")}</TableHead>
          <TableHead>{t("reports:drill.note")}</TableHead>
          <TableHead>{t("reports:columns.currency")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="whitespace-nowrap">
              {item.date ?? "—"}
            </TableCell>
            <TableCell>{item.person ?? "—"}</TableCell>
            <TableCell>{item.projectKey ?? "—"}</TableCell>
            <TableCell className="whitespace-nowrap">
              {item.workItemKey ? (
                <Link
                  to="/agent/work-items/$key"
                  params={{ key: item.workItemKey }}
                  className={linkClass}
                >
                  {item.workItemKey}
                </Link>
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="max-w-64 truncate">{item.title}</TableCell>
            <TableCell>{item.currency ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ArticleRows({ items }: { items: DrillItem[] }) {
  const { t } = useTranslation();
  return (
    <Table aria-label={t("reports:drill.title")}>
      <TableHeader>
        <TableRow>
          <TableHead>{t("reports:drill.article")}</TableHead>
          <TableHead>{t("reports:drill.state")}</TableHead>
          <TableHead>{t("reports:drill.project")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.key}>
            <TableCell className="max-w-96 truncate">
              <Link
                to="/agent/kb/$id"
                params={{ id: item.key }}
                className={linkClass}
              >
                {item.title}
              </Link>
            </TableCell>
            <TableCell>{item.state ?? "—"}</TableCell>
            <TableCell>{item.projectKey ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type DrillQuery = {
  data?: { data: DrillItem[] } | undefined;
  isLoading: boolean;
  isError: boolean;
};

/**
 * `RP-12`: from a number to the things behind it, under exactly the same window, filters and
 * reach. A metric you cannot interrogate is not trustworthy. The kind of the items says which table
 * is shown: work items, time entries (hours only), cost entries or knowledge base articles.
 */
export function DrillItemsDialog({
  items,
  onClose,
}: {
  items: DrillQuery;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const list = items.data?.data ?? [];
  const kind = list[0]?.kind ?? "work_item";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("common:actions.close")}
        className="max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t("reports:drill.title")}</DialogTitle>
          <DialogDescription>
            {t("reports:drill.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-6 pb-6">
          {items.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : items.isError ? (
            <p className="text-destructive-foreground text-sm">
              {t("reports:drill.loadError")}
            </p>
          ) : list.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>—</EmptyTitle>
                <EmptyDescription>{t("reports:drill.empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : kind === "time_entry" ? (
            <TimeEntryRows items={list} />
          ) : kind === "cost_entry" ? (
            <CostEntryRows items={list} />
          ) : kind === "article" ? (
            <ArticleRows items={list} />
          ) : (
            <WorkItemRows items={list} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The drill of a fixed report. */
export function ReportDrillDialog({
  workspaceId,
  reportKey,
  search,
  handle,
  onClose,
}: {
  workspaceId: string;
  reportKey: string;
  search: ReportSearch;
  handle: string;
  onClose: () => void;
}) {
  const items = useReportItems(workspaceId, reportKey, search, handle, true);
  return <DrillItemsDialog items={items} onClose={onClose} />;
}

/** The drill of a dashboard widget (a report of any tier, under the widget's own window and filters). */
export function WidgetDrillDialog({
  workspaceId,
  dashboardId,
  widgetId,
  handle,
  onClose,
}: {
  workspaceId: string;
  dashboardId: string;
  widgetId: string;
  handle: string;
  onClose: () => void;
}) {
  const items = useWidgetItems(
    workspaceId,
    dashboardId,
    widgetId,
    handle,
    true,
  );
  return <DrillItemsDialog items={items} onClose={onClose} />;
}

/** The drill of a tier 3 report that is still being built. */
export function CustomDrillDialog({
  workspaceId,
  body,
  handle,
  onClose,
}: {
  workspaceId: string;
  body: {
    name?: string;
    query: CustomQueryInput;
    chartType: "bar" | "line" | "table" | "number";
  };
  handle: string;
  onClose: () => void;
}) {
  const items = useCustomItems(workspaceId, body, handle, true);
  return <DrillItemsDialog items={items} onClose={onClose} />;
}
