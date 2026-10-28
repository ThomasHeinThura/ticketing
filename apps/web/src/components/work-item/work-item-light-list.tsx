import { buttonVariants } from "@taskdesk/ui";
import {
  Archive,
  Calendar,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  parseCollapsedGroups,
  useProjectViewPreference,
} from "@/hooks/use-project-view-preference";
import { cn } from "@/lib/cn";
import { dueDateStatusColors, getDueDateStatus } from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { getPriorityIcon } from "@/lib/priority";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { WorkItemRow } from "@/types/work-item";

type LightListState = { id: string; name: string; group: string };

/** Row and group-header heights of the hydrated grouped list (Kaneo `TaskRow`, `ListColumnSection`). */
const ROW_HEIGHT = 45;
const HEADER_HEIGHT = 49;
/** The virtual window's estimate for rows it has not measured yet. */
const ESTIMATED_ROW_HEIGHT = 46;

const ICON_CLASS = "w-4 h-4 text-muted-foreground";
const CATEGORY_ICON: Record<string, typeof Circle> = {
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CheckCircle2,
  cancelled: Archive,
};

let dueDateFormat: Intl.DateTimeFormat | undefined;

function getDueDateFormat() {
  dueDateFormat ??= new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return dueDateFormat;
}

/**
 * The grouped Kaneo list's first viewport, painted from the already-fetched rows while the
 * list's interactive modules (virtual window, drag and drop, inline controls) download (G11
 * work-list LCP). It reproduces `ListColumnSection` and `TaskRow` with the inline controls'
 * static presentation, box for box, so the hydrated list replaces it without moving anything;
 * rows below the viewport are a spacer of the virtual window's estimated height. It is a
 * read-only preview: nothing in it is focusable or clickable, and it carries none of the
 * hydrated list's markers (`work-item-list-populated`, `data-task-id`,
 * `data-primary-content-ready`), so readiness checks still wait for the real list.
 */
export default function WorkItemLightList({
  projectId,
  workItems,
  states,
}: {
  projectId: string | undefined;
  workItems: WorkItemRow[];
  states: LightListState[];
}) {
  const { t } = useTranslation();
  const collapsedIds = useProjectViewPreference({
    projectId,
    name: "listGroups",
    parse: parseCollapsedGroups,
  }).value;
  const preferences = useUserPreferencesStore(
    useShallow((state) => ({
      showAssignees: state.showAssignees,
      showPriority: state.showPriority,
      showDueDates: state.showDueDates,
      showTaskNumbers: state.showTaskNumbers,
    })),
  );
  const itemsByState = new Map<string, WorkItemRow[]>();
  for (const item of workItems) {
    const items = itemsByState.get(item.stateId) ?? [];
    items.push(item);
    itemsByState.set(item.stateId, items);
  }
  let remainingHeight =
    (typeof window === "undefined" ? 900 : window.innerHeight) + ROW_HEIGHT;

  return (
    <div
      className="w-full bg-muted/20"
      data-testid="work-item-list-preview"
      aria-busy="true"
    >
      <span className="sr-only">{t("workItems:list.loading")}</span>
      <div className="divide-y divide-border/50" aria-hidden="true">
        {states.map((state) => {
          const items = itemsByState.get(state.id) ?? [];
          const expanded = !collapsedIds?.includes(state.id);
          const isFinal =
            state.group === "completed" || state.group === "cancelled";
          remainingHeight -= HEADER_HEIGHT;
          const visibleCount = expanded
            ? Math.max(
                0,
                Math.min(items.length, Math.ceil(remainingHeight / ROW_HEIGHT)),
              )
            : 0;
          remainingHeight -= visibleCount * ROW_HEIGHT;
          const HeaderIcon = isFinal ? CheckCircle2 : Circle;
          return (
            <div
              key={state.id}
              className="border-b border-border/50 transition-colors duration-150 overflow-auto"
            >
              <div className="flex items-center justify-between py-2 px-4 bg-muted/60 border-b border-border/50">
                <div
                  className={cn(
                    buttonVariants({
                      variant: "ghost",
                      className:
                        "flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors",
                    }),
                    "cursor-default",
                  )}
                >
                  <ChevronRight
                    className={cn(
                      "w-3 h-3 transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <div className="flex items-center gap-2 h-4">
                    <HeaderIcon className={ICON_CLASS} />
                    <div className="flex items-center gap-1">
                      <span className="mt-1 mr-1">{state.name}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {items.length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              {expanded ? (
                <div className="bg-card">
                  {items.slice(0, visibleCount).map((item) => (
                    <LightRow
                      key={item.id}
                      item={item}
                      isFinal={isFinal}
                      preferences={preferences}
                    />
                  ))}
                  {items.length > visibleCount ? (
                    <div
                      style={{
                        height:
                          (items.length - visibleCount) * ESTIMATED_ROW_HEIGHT,
                      }}
                    />
                  ) : null}
                  {items.length === 0 ? (
                    <div className="py-6 px-4 text-center text-xs text-muted-foreground">
                      {t("tasks:listView.noTasks")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LightRow({
  item,
  isFinal,
  preferences,
}: {
  item: WorkItemRow;
  isFinal: boolean;
  preferences: {
    showAssignees: boolean;
    showPriority: boolean;
    showDueDates: boolean;
    showTaskNumbers: boolean;
  };
}) {
  const StateIcon = CATEGORY_ICON[item.stateCategory] ?? Circle;
  const dueDateStatus = item.dueDate
    ? getDueDateStatus(item.dueDate, isFinal)
    : undefined;
  return (
    <div className="border-b border-border/50 transition-colors duration-150">
      <div className="group relative m-0 flex w-full min-w-0 max-w-none flex-row items-center gap-3 border-0 p-0 px-4 py-1.5">
        {preferences.showPriority ? (
          <div>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
              {item.unavailableFields.includes("priority")
                ? "–"
                : getPriorityIcon(item.priority ?? "")}
            </span>
          </div>
        ) : null}
        {preferences.showTaskNumbers ? (
          <div className="text-xs font-mono text-muted-foreground flex-shrink-0">
            {item.key}
          </div>
        ) : null}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div>
              <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-xs text-muted-foreground">
                <StateIcon className={ICON_CLASS} />
                <span className="truncate">{item.stateName}</span>
              </span>
            </div>
            <span className="min-w-24 flex-1 basis-24 truncate text-left text-sm text-foreground">
              <span>{item.title}</span>
            </span>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1" />
          </div>
        </div>
        {preferences.showDueDates && item.dueDate && dueDateStatus ? (
          <div
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded flex-shrink-0 ${dueDateStatusColors[dueDateStatus]}`}
          >
            {dueDateStatus === "overdue" ? (
              <CalendarX className="w-3 h-3" />
            ) : dueDateStatus === "due-soon" ? (
              <CalendarClock className="w-3 h-3" />
            ) : (
              <Calendar className="w-3 h-3" />
            )}
            <span>{getDueDateFormat().format(new Date(item.dueDate))}</span>
          </div>
        ) : null}
        {preferences.showAssignees ? (
          <div>
            <span
              className={cn(
                buttonVariants({
                  variant: "ghost",
                  size: "icon",
                  className: "h-7 w-7 shrink-0 rounded-full",
                }),
                "cursor-default",
              )}
            >
              {item.assigneeId !== null && item.assigneeName ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px]">
                  {getInitials(item.assigneeName)}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">?</span>
              )}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * True when the preview can stand in for the grouped list: the rows and states are loaded and
 * every row has an active state, in an order the hydrated list keeps (manual position order is
 * ranked client-side, so it waits for the real list). Error, partial, empty and deleted or
 * archived rows keep their table semantics (`WorkItemList`).
 */
export function canPreviewWorkItemList({
  workItems,
  states,
  sort,
  hasPartialFailure,
}: {
  workItems: WorkItemRow[] | undefined;
  states: LightListState[] | undefined;
  sort: string;
  hasPartialFailure?: boolean;
}): boolean {
  if (!workItems?.length || !states || hasPartialFailure) return false;
  if (sort === "position") return false;
  const stateIds = new Set(states.map((state) => state.id));
  return workItems.every(
    (item) => !item.deletedAt && !item.archivedAt && stateIds.has(item.stateId),
  );
}
