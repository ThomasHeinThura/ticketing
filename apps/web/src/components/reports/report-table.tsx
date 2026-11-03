import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import { MoveHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReportCell, ReportColumn } from "@/fetchers/report";
import { cellText, columnLabel, isInsufficient } from "./report-format";

const NUMERIC = new Set(["number", "percent", "hours", "days", "money"]);

/**
 * The table every chart has (`RP-11`) and the main view of a report that is only a table. A row
 * with a drill handle opens the items behind it (`RP-12`).
 */
export function ReportTable({
  columns,
  rows,
  label,
  onDrill,
}: {
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  /** The accessible name of the table. */
  label: string;
  onDrill?: ((handle: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  if (columns.length === 0) return null;
  return (
    // A wide table scrolls sideways inside its own named, focusable frame, never the page. While
    // it overflows, the cut edge fades and a hint above it says so (shown by CSS from the frame's
    // overflow state, so it follows every resize without a measuring pass).
    <div
      className="group/report-table w-full min-w-0 space-y-2"
      data-slot="report-table"
    >
      <p
        className="hidden items-center gap-1.5 text-muted-foreground text-xs group-has-[[data-slot=scroll-area-viewport][data-has-overflow-x]]/report-table:flex"
        data-testid="table-scroll-hint"
      >
        <MoveHorizontal aria-hidden="true" className="size-3.5 shrink-0" />
        {t("reports:chartScroll.hint", { count: columns.length })}
      </p>
      <Table aria-label={label} scrollLabel={label} scrollFade>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={NUMERIC.has(column.kind) ? "text-right" : undefined}
              >
                {columnLabel(column, t)}
              </TableHead>
            ))}
            {onDrill ? (
              <TableHead className="w-28">
                <span className="sr-only">{t("reports:drill.column")}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const handle = typeof row._drill === "string" ? row._drill : null;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: report rows have no stable id
              <TableRow key={index}>
                {columns.map((column) => {
                  const cell = row[column.key];
                  return (
                    <TableCell
                      key={column.key}
                      className={
                        NUMERIC.has(column.kind)
                          ? isInsufficient(cell)
                            ? "text-right text-muted-foreground"
                            : "text-right tabular-nums"
                          : undefined
                      }
                    >
                      {cellText(cell, column, row, t)}
                    </TableCell>
                  );
                })}
                {onDrill ? (
                  <TableCell className="text-right">
                    {handle !== null ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDrill(handle)}
                      >
                        {t("reports:drill.open")}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
