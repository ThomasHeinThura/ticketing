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
import { useReportItems } from "@/hooks/queries/report";
import type { ReportSearch } from "@/lib/report-search";

/**
 * `RP-12`: from a number to the work items behind it, under exactly the same window, filters and
 * reach. A metric you cannot interrogate is not trustworthy.
 */
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
  const { t } = useTranslation();
  const items = useReportItems(workspaceId, reportKey, search, handle, true);
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
          ) : (items.data?.data.length ?? 0) === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>—</EmptyTitle>
                <EmptyDescription>{t("reports:drill.empty")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
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
                {items.data?.data.map((item) => (
                  <TableRow key={item.key}>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        to="/agent/work-items/$key"
                        params={{ key: item.key }}
                        className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.key}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">
                      {item.title}
                    </TableCell>
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
