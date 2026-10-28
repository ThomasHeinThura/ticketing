import { Skeleton } from "@taskdesk/ui";
import { ColumnShell } from "@/components/kanban-board/column/column-shell";

const COLUMNS = ["one", "two", "three", "four"] as const;
const CARDS = ["first", "second", "third"] as const;

/**
 * The board's loading state, laid out as the loaded board: the same container, Kaneo column
 * shells at the board's column widths and full height, a header row and card-sized blocks. The
 * loaded board then replaces it in place instead of growing out of a short strip (G13).
 */
export default function WorkItemBoardSkeleton() {
  return (
    <div
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      aria-busy="true"
      data-testid="work-item-board-loading"
    >
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-max gap-4 px-4 py-4 md:px-5">
          {COLUMNS.map((column) => (
            <div
              key={column}
              className="h-full min-h-0 max-w-96 min-w-80 shrink-0 flex-1"
            >
              <ColumnShell
                aria-hidden="true"
                header={
                  <div className="flex h-7 items-center gap-2">
                    <Skeleton className="size-4 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                }
              >
                <div className="flex flex-col gap-2 py-1">
                  {CARDS.map((card) => (
                    <Skeleton key={card} className="h-28 w-full rounded-xl" />
                  ))}
                </div>
              </ColumnShell>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
