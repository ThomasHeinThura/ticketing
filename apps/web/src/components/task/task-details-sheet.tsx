import { Sheet, SheetContent } from "@taskdesk/ui";
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  TaskDetailsSkeleton,
  TaskPropertiesSidebarSkeleton,
} from "./task-page-skeleton";

const TaskDetailsSheetBody = lazy(() => import("./task-details-sheet-body"));

type TaskDetailsSheetProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
};

function TaskDetailsSheetLoading() {
  return (
    <div
      aria-busy="true"
      className="flex flex-col flex-1 min-h-0 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background shrink-0">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-8 w-20 rounded bg-muted" />
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <TaskPropertiesSidebarSkeleton className="w-full bg-sidebar border-b border-border flex flex-col gap-0 overflow-y-auto shrink-0" />
        <div className="flex-1 overflow-y-auto min-h-0">
          <TaskDetailsSkeleton className="px-4 py-4" />
        </div>
      </div>
    </div>
  );
}

/** Original Kaneo sheet geometry and retained-content lifecycle, shared by both data models. */
export function TaskDetailsSheetFrame({
  itemId,
  onClose,
  children,
  ariaLabel,
  finalFocus,
}: {
  itemId: string | undefined;
  onClose: () => void;
  children: (visibleItemId: string) => ReactNode;
  ariaLabel?: string;
  /** Where focus goes on close when the sheet was opened from URL state, not a trigger. */
  finalFocus?: ComponentProps<typeof SheetContent>["finalFocus"];
}) {
  const { t } = useTranslation();
  const [currentItemId, setCurrentItemId] = useState<string | undefined>(
    itemId,
  );

  useEffect(() => {
    if (itemId) {
      // Update itemId immediately without closing/reopening
      setCurrentItemId(itemId);
    } else {
      // Delay clearing to allow exit animation
      const timer = setTimeout(() => {
        setCurrentItemId(undefined);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [itemId]);

  const visibleItemId = itemId ?? currentItemId;

  return (
    <Sheet open={!!itemId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-full sm:max-w-lg md:max-w-2xl lg:max-w-4xl p-0 gap-0 [&>button]:hidden"
        closeLabel={t("common:actions.close")}
        aria-label={ariaLabel}
        finalFocus={finalFocus}
      >
        {visibleItemId ? children(visibleItemId) : null}
      </SheetContent>
    </Sheet>
  );
}

export default function TaskDetailsSheet({
  taskId,
  projectId,
  workspaceId,
  onClose,
}: TaskDetailsSheetProps) {
  return (
    <TaskDetailsSheetFrame itemId={taskId} onClose={onClose}>
      {(visibleTaskId) => (
        <Suspense fallback={<TaskDetailsSheetLoading />}>
          <TaskDetailsSheetBody
            key={visibleTaskId}
            taskId={visibleTaskId}
            projectId={projectId}
            workspaceId={workspaceId}
            onClose={onClose}
          />
        </Suspense>
      )}
    </TaskDetailsSheetFrame>
  );
}
