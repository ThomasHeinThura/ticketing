import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
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
    <Table aria-label={label}>
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
  );
}
