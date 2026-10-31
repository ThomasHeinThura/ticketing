import { Button, Skeleton } from "@taskdesk/ui";
import { X } from "lucide-react";
import { lazy, Suspense, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TaskDetailsSheetFrame } from "@/components/task/task-details-sheet";

const SubmissionDetailSheetBody = lazy(
  () => import("./submission-detail-sheet-body"),
);

/** The queue row's reference button carries this attribute so the sheet can return focus to it. */
export const SUBMISSION_ROW_ATTRIBUTE = "data-submission-ref";

function SubmissionDetailSheetLoading({
  submissionRef,
  onClose,
}: {
  submissionRef: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b bg-background px-4 py-2.5">
        <span className="font-medium font-mono text-muted-foreground text-sm">
          {submissionRef}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="text-foreground"
          aria-label={t("common:actions.close")}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

/**
 * `?ref=SUB-n` on the intake queue (plain and saved queues): the selected submission opens in
 * Kaneo's task side sheet, the same frame the work-item side pane uses (`VW-4`). Closing it
 * (button, Escape or backdrop) clears `ref` and returns focus to the row that opened it.
 */
export function SubmissionDetailSheet({
  submissionRef,
  workspaceId,
  rowSummary,
  onClose,
  onOpenWorkItem,
}: {
  submissionRef: string | undefined;
  workspaceId: string | undefined;
  /** The queue row's summary when the caller has it; the body derives it otherwise. */
  rowSummary?: (ref: string) => string | undefined;
  onClose: () => void;
  onOpenWorkItem: (key: string) => void;
}) {
  const { t } = useTranslation("intake");
  // `onClose` clears `ref` before the sheet hands focus back, so remember the last one.
  const lastRef = useRef(submissionRef);
  if (submissionRef) lastRef.current = submissionRef;
  const finalFocus = useCallback(() => {
    const ref = lastRef.current;
    const row = ref
      ? document.querySelector<HTMLElement>(
          `[${SUBMISSION_ROW_ATTRIBUTE}="${ref}"]`,
        )
      : null;
    return row ?? true;
  }, []);

  return (
    <TaskDetailsSheetFrame
      itemId={submissionRef}
      onClose={onClose}
      ariaLabel={t("submissionRegion", { ref: submissionRef ?? "" })}
      finalFocus={finalFocus}
    >
      {(visibleRef) => (
        <Suspense
          fallback={
            <SubmissionDetailSheetLoading
              submissionRef={visibleRef}
              onClose={onClose}
            />
          }
        >
          <SubmissionDetailSheetBody
            submissionRef={visibleRef}
            workspaceId={workspaceId}
            rowSummary={rowSummary?.(visibleRef)}
            onClose={onClose}
            onOpenWorkItem={onOpenWorkItem}
          />
        </Suspense>
      )}
    </TaskDetailsSheetFrame>
  );
}
