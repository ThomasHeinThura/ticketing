import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@taskdesk/ui";
import type {
  ComponentProps,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeVirtualRange } from "./virtualization/range";

type Props<Row, Column extends string, RowControl = undefined> = {
  rows: readonly Row[];
  columns: readonly Column[];
  getRowId: (row: Row) => string;
  columnWidthFactors: readonly number[];
  renderHeader: (column: Column) => ReactNode;
  columnWidths?: Partial<Record<Column, number>>;
  renderResizeHandle?: (column: Column, width: number) => ReactNode;
  headerAttributes?: (
    column: Column,
  ) => Pick<ComponentProps<typeof TableHead>, "aria-sort">;
  renderCell: (row: Row, column: Column, rowControl?: RowControl) => ReactNode;
  /** Wrap a measured virtual row once, sharing controls across its editable cells. */
  renderRow?: (
    row: Row,
    renderMeasuredRow: (rowControl?: RowControl) => ReactNode,
  ) => ReactNode;
  leadingWidth?: number;
  trailingWidth?: number;
  renderLeadingHeader?: () => ReactNode;
  renderLeadingCell?: (row: Row) => ReactNode;
  renderTrailingHeader?: () => ReactNode;
  renderTrailingCell?: (row: Row) => ReactNode;
  className?: string;
  testId?: string;
  onMouseOver?: ComponentProps<typeof Table>["onMouseOver"];
  onFocusCapture?: ComponentProps<typeof Table>["onFocusCapture"];
  onClickCapture?: ComponentProps<typeof Table>["onClickCapture"];
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const MIN_COLUMN_WIDTH = 96;

function findVerticalScrollParent(element: HTMLElement | null) {
  let current = element?.parentElement ?? null;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return element?.parentElement ?? null;
}

function focusTargets(row: HTMLElement) {
  return Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (target) =>
      !target.hasAttribute("disabled") &&
      target.getAttribute("aria-hidden") !== "true" &&
      target.getAttribute("tabindex") !== "-1",
  );
}

/** Kaneo library table with bounded row and horizontal column windows. */
export default function WorkItemTable<
  Row,
  Column extends string,
  RowControl = undefined,
>({
  rows,
  columns,
  getRowId,
  columnWidthFactors,
  renderHeader,
  columnWidths: savedColumnWidths,
  renderResizeHandle,
  headerAttributes,
  renderCell,
  renderRow,
  leadingWidth = 0,
  trailingWidth = 0,
  renderLeadingHeader,
  renderLeadingCell,
  renderTrailingHeader,
  renderTrailingCell,
  className,
  testId,
  onMouseOver,
  onFocusCapture,
  onClickCapture,
}: Props<Row, Column, RowControl>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tableElement = () => hostRef.current?.querySelector("table") ?? null;
  const table = tableElement();
  const pendingFocus = useRef<{ id: string; backwards: boolean } | null>(null);
  const [focusedRowId, setFocusedRowId] = useState<string>();
  const [focusedColumnIndex, setFocusedColumnIndex] = useState(-1);
  const rowIds = useMemo(() => rows.map(getRowId), [getRowId, rows]);
  const focusedRowIndex = focusedRowId ? rowIds.indexOf(focusedRowId) : -1;
  const horizontalElement = table?.parentElement ?? null;
  const availableWidth = horizontalElement?.clientWidth || 960;
  const fixedWidth = leadingWidth + trailingWidth;
  const columnSpace = Math.max(1, availableWidth - fixedWidth);
  const factorTotal =
    columnWidthFactors.reduce((sum, factor) => sum + factor, 0) || 1;
  const columnWidths = useMemo(
    () =>
      columns.map(
        (column, index) =>
          savedColumnWidths?.[column] ??
          Math.max(
            MIN_COLUMN_WIDTH,
            (columnSpace * (columnWidthFactors[index] ?? 1)) / factorTotal,
          ),
      ),
    [columnSpace, columnWidthFactors, columns, factorTotal, savedColumnWidths],
  );
  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const totalTableWidth = totalColumnWidth + fixedWidth;
  const scrollElement = findVerticalScrollParent(table);
  const scrollMargin =
    table && scrollElement
      ? (table.getBoundingClientRect().top ?? 0) -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop
      : 0;

  const rowRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      mergeVirtualRange(defaultRangeExtractor(range), rows.length, [
        focusedRowIndex,
      ]),
    [focusedRowIndex, rows.length],
  );
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => findVerticalScrollParent(tableElement()),
    initialRect: { width: 960, height: 640 },
    estimateSize: () => 42,
    getItemKey: (index) => rowIds[index] ?? index,
    overscan: 8,
    scrollMargin,
    rangeExtractor: rowRangeExtractor,
  });
  const columnRangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      mergeVirtualRange(defaultRangeExtractor(range), columns.length, [
        focusedColumnIndex,
      ]),
    [columns.length, focusedColumnIndex],
  );
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => tableElement()?.parentElement ?? null,
    initialRect: { width: 960, height: 640 },
    estimateSize: (index) => columnWidths[index] ?? 120,
    overscan: 1,
    rangeExtractor: columnRangeExtractor,
  });
  const columnWidthSignature = columnWidths.join(",");
  useLayoutEffect(() => {
    if (columnWidthSignature) columnVirtualizer.measure();
  }, [columnVirtualizer, columnWidthSignature]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const leftPadding = virtualColumns[0]?.start ?? 0;
  const rightPadding = Math.max(
    0,
    columnVirtualizer.getTotalSize() - (virtualColumns.at(-1)?.end ?? 0),
  );
  const topPadding = Math.max(
    0,
    (virtualRows[0]?.start ?? scrollMargin) - scrollMargin,
  );
  const bottomPadding = Math.max(
    0,
    rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? scrollMargin),
  );

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    const currentTable = tableElement();
    if (!pending || !currentTable) return;
    const row = Array.from(
      currentTable.querySelectorAll<HTMLElement>("[data-virtual-row-id]"),
    ).find((element) => element.dataset.virtualRowId === pending.id);
    if (!row) return;
    const targets = focusTargets(row);
    const target = pending.backwards ? targets.at(-1) : targets[0];
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });

  const handleFocus = (event: FocusEvent<HTMLTableElement>) => {
    onFocusCapture?.(event);
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>("[data-virtual-row-id]");
    if (row?.dataset.virtualRowId) setFocusedRowId(row.dataset.virtualRowId);
    const cell = event.target.closest<HTMLElement>(
      "[data-virtual-column-index]",
    );
    if (cell) setFocusedColumnIndex(Number(cell.dataset.virtualColumnIndex));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (
      event.key !== "Tab" ||
      event.defaultPrevented ||
      !(event.target instanceof Element)
    ) {
      return;
    }
    const row = event.target.closest<HTMLElement>("[data-virtual-row-id]");
    const id = row?.dataset.virtualRowId;
    const index = id ? rowIds.indexOf(id) : -1;
    if (!row || index < 0) return;
    const targets = focusTargets(row);
    const focusedIndex = targets.indexOf(document.activeElement as HTMLElement);
    const backwards = event.shiftKey;
    const atBoundary = backwards
      ? focusedIndex === 0
      : focusedIndex === targets.length - 1;
    const nextIndex = index + (backwards ? -1 : 1);
    if (!atBoundary || nextIndex < 0 || nextIndex >= rows.length) return;
    const nextId = rowIds[nextIndex];
    if (!nextId) return;
    event.preventDefault();
    pendingFocus.current = { id: nextId, backwards };
    setFocusedRowId(nextId);
    rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });
  };

  const visibleColumnSpan =
    virtualColumns.length + Number(leftPadding > 0) + Number(rightPadding > 0);
  const fullColumnSpan =
    columns.length + Number(leadingWidth > 0) + Number(trailingWidth > 0);

  return (
    <div ref={hostRef}>
      <Table
        data-testid={testId}
        data-virtualized-table="true"
        data-primary-content-ready="true"
        className={className}
        style={{ width: totalTableWidth, minWidth: totalTableWidth }}
        onMouseOver={onMouseOver}
        onFocusCapture={handleFocus}
        onKeyDownCapture={handleKeyDown}
        onClickCapture={onClickCapture}
      >
        <colgroup>
          {leadingWidth > 0 ? <col style={{ width: leadingWidth }} /> : null}
          {leftPadding > 0 ? <col style={{ width: leftPadding }} /> : null}
          {virtualColumns.map((virtualColumn) => (
            <col
              key={columns[virtualColumn.index]}
              style={{ width: columnWidths[virtualColumn.index] }}
            />
          ))}
          {rightPadding > 0 ? <col style={{ width: rightPadding }} /> : null}
          {trailingWidth > 0 ? <col style={{ width: trailingWidth }} /> : null}
        </colgroup>
        <TableHeader>
          <TableRow>
            {renderLeadingHeader ? (
              <TableHead style={{ width: leadingWidth }}>
                {renderLeadingHeader()}
              </TableHead>
            ) : null}
            {leftPadding > 0 ? (
              <TableHead aria-hidden="true" style={{ width: leftPadding }} />
            ) : null}
            {virtualColumns.map((virtualColumn) => {
              const column = columns[virtualColumn.index];
              if (!column) return null;
              return (
                <TableHead
                  key={column}
                  {...headerAttributes?.(column)}
                  data-virtual-column-index={virtualColumn.index}
                  style={{ width: columnWidths[virtualColumn.index] }}
                >
                  <div className="flex min-w-0 items-center justify-between gap-1">
                    <div className="min-w-0 flex-1">{renderHeader(column)}</div>
                    {renderResizeHandle?.(
                      column,
                      columnWidths[virtualColumn.index] ?? MIN_COLUMN_WIDTH,
                    )}
                  </div>
                </TableHead>
              );
            })}
            {rightPadding > 0 ? (
              <TableHead aria-hidden="true" style={{ width: rightPadding }} />
            ) : null}
            {renderTrailingHeader ? (
              <TableHead style={{ width: trailingWidth }}>
                {renderTrailingHeader()}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {topPadding > 0 ? (
            <TableRow aria-hidden="true">
              <TableCell
                colSpan={fullColumnSpan}
                className="p-0"
                style={{ height: topPadding }}
              />
            </TableRow>
          ) : null}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            const rowId = rowIds[virtualRow.index];
            if (!row || !rowId) return null;
            const renderMeasuredRow = (rowControl?: RowControl) => (
              <TableRow
                key={rowId}
                ref={(node) => rowVirtualizer.measureElement(node)}
                data-index={virtualRow.index}
                data-virtual-row-id={rowId}
              >
                {renderLeadingCell ? (
                  <TableCell style={{ width: leadingWidth }}>
                    {renderLeadingCell(row)}
                  </TableCell>
                ) : null}
                {leftPadding > 0 ? (
                  <TableCell
                    aria-hidden="true"
                    className="p-0"
                    style={{ width: leftPadding }}
                  />
                ) : null}
                {virtualColumns.map((virtualColumn) => {
                  const column = columns[virtualColumn.index];
                  if (!column) return null;
                  return (
                    <TableCell
                      key={column}
                      data-virtual-column-index={virtualColumn.index}
                      style={{ width: columnWidths[virtualColumn.index] }}
                    >
                      {renderCell(row, column, rowControl)}
                    </TableCell>
                  );
                })}
                {rightPadding > 0 ? (
                  <TableCell
                    aria-hidden="true"
                    className="p-0"
                    style={{ width: rightPadding }}
                  />
                ) : null}
                {renderTrailingCell ? (
                  <TableCell style={{ width: trailingWidth }}>
                    {renderTrailingCell(row)}
                  </TableCell>
                ) : null}
              </TableRow>
            );
            return renderRow
              ? renderRow(row, renderMeasuredRow)
              : renderMeasuredRow();
          })}
          {bottomPadding > 0 ? (
            <TableRow aria-hidden="true">
              <TableCell
                colSpan={
                  visibleColumnSpan +
                  Number(leadingWidth > 0) +
                  Number(trailingWidth > 0)
                }
                className="p-0"
                style={{ height: bottomPadding }}
              />
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
