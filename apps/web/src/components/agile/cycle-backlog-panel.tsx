import { useDraggable } from "@dnd-kit/core";
import { Alert, AlertDescription, Badge, Button, Skeleton } from "@taskdesk/ui";
import { GripVertical, Plus } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import type { WorkItemRow } from "@/types/work-item";
import { agileFieldsOf } from "./work-item-agile-fields";

export const BACKLOG_DRAG_PREFIX = "backlog:";

function BacklogRow({
  item,
  canAdd,
  onAdd,
}: {
  item: WorkItemRow;
  canAdd: boolean;
  onAdd: (key: string) => void;
}) {
  const { t } = useTranslation("agile");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${BACKLOG_DRAG_PREFIX}${item.key}`,
    disabled: !canAdd,
  });
  return (
    <li
      ref={setNodeRef}
      className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm data-[dragging=true]:opacity-50"
      data-dragging={isDragging}
      data-testid={`backlog-row-${item.key}`}
    >
      {canAdd ? (
        <Button
          {...attributes}
          {...listeners}
          variant="ghost"
          size="icon-xs"
          aria-label={t("backlog.dragHandle", { key: item.key })}
          className="cursor-grab text-muted-foreground"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      <span className="shrink-0 font-mono text-muted-foreground text-xs">
        {item.key}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <Badge variant="outline" size="sm">
        {item.stateName}
      </Badge>
      {canAdd ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("backlog.addNamed", { key: item.key })}
          onClick={() => onAdd(item.key)}
        >
          <Plus aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

/**
 * `CY-5`: the project's open work that is in no cycle, as a side list whose rows can be dragged
 * into the cycle (or added with the button, which is the keyboard and touch path).
 */
export function CycleBacklogPanel({
  project,
  workspaceId,
  canAdd,
  onAdd,
  kind = "cycle",
}: {
  project: { id: string; slug: string };
  workspaceId: string;
  canAdd: boolean;
  onAdd: (key: string) => void;
  /** Which membership the listed work lacks: no cycle (default) or no module. */
  kind?: "cycle" | "module";
}) {
  const { t } = useTranslation("agile");
  const query = useGetBoardWorkItems({
    projectId: project.id,
    projectSlug: project.slug,
    workspaceId,
    sort: "position",
    dir: "asc",
    realtimeStatus: "connecting",
  });
  const items = useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (item) =>
          (kind === "cycle"
            ? agileFieldsOf(item).cycleId
            : agileFieldsOf(item).moduleId) === null &&
          item.stateCategory !== "completed" &&
          item.stateCategory !== "cancelled" &&
          !item.unavailableFields.includes("key"),
      ),
    [query.data, kind],
  );
  return (
    <section
      aria-label={t(kind === "cycle" ? "backlog.title" : "backlog.moduleTitle")}
      className="flex min-w-0 flex-col gap-2"
      data-testid="cycle-backlog"
    >
      <h2 className="font-medium text-sm">
        {t(kind === "cycle" ? "backlog.title" : "backlog.moduleTitle")}
      </h2>
      <p className="text-muted-foreground text-xs">
        {canAdd
          ? t(kind === "cycle" ? "backlog.hint" : "backlog.moduleHint")
          : t("backlog.readOnly")}
      </p>
      {query.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : query.isError ? (
        <Alert variant="error">
          <AlertDescription>{t("backlog.loadFailed")}</AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("backlog.empty")}</p>
      ) : (
        <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto">
          {items.map((item) => (
            <BacklogRow
              key={item.id}
              item={item}
              canAdd={canAdd}
              onAdd={onAdd}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
