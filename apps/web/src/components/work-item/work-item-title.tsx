import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TaskTitlePresentation } from "@/components/task/task-detail-presentation";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useWorkItemFeedback } from "./work-item-feedback";
import {
  cachedWorkItem,
  useSaveWorkItemFields,
  workItemDetailKey,
} from "./work-item-save";

export const TITLE_SAVE_DELAY_MS = 800;

/**
 * Kaneo's borderless task title (`task-title.tsx`), saved to the work item after a short
 * pause with its version; an empty title is never sent. A pending save is flushed on blur
 * and on unmount (closing the pane inside the pause keeps the edit). On a version conflict
 * the field returns to the server's title; any other failure keeps the text, says it is
 * not saved, and tries again on blur.
 */
export default function WorkItemTitle({
  item,
  onAccessLost,
  readOnly = false,
}: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce, reportConflict, clearConflict } = useWorkItemFeedback();
  const { canUpdateTasks } = useWorkspacePermission(
    item.workspaceId,
    item.projectId,
  );
  const [value, setValue] = useState(item.title);
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text typed but not yet confirmed saved; null when the field matches the server.
  const unsaved = useRef<string | null>(null);
  // The title of the save in flight: a blur right after the pause must not send it again.
  const inFlight = useRef<string | null>(null);
  const pendingWrites = useRef(0);

  const update = useSaveWorkItemFields(item, {
    onSettled: () => {
      pendingWrites.current -= 1;
      if (pendingWrites.current === 0) inFlight.current = null;
    },
    onError: async (error) => {
      if (isWorkItemAccessLost(error)) {
        onAccessLost();
        return;
      }
      if (error instanceof WorkItemVersionConflictError) {
        unsaved.current = null;
        setFailed(false);
        reportConflict();
        await queryClient.refetchQueries({
          queryKey: workItemDetailKey(item.key),
        });
        setValue(
          queryClient.getQueryData<WorkItemDetailRow>(
            workItemDetailKey(item.key),
          )?.title ?? item.title,
        );
        return;
      }
      setFailed(true);
    },
  });

  const save = (text: string) => {
    const title = text.trim();
    if (
      !title ||
      (pendingWrites.current === 0 &&
        title === cachedWorkItem(queryClient, item).title)
    ) {
      if (unsaved.current === text) unsaved.current = null;
      setFailed(false);
      return;
    }
    // Already on its way; its answer clears `unsaved`.
    if (title === inFlight.current) return;
    inFlight.current = title;
    pendingWrites.current += 1;
    update.mutate(
      { title },
      {
        onSuccess: () => {
          if (unsaved.current === text) unsaved.current = null;
          setFailed(false);
          clearConflict();
          announce(t("workItems:journey.editSaved"));
        },
      },
    );
  };

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (unsaved.current !== null) save(unsaved.current);
  };

  // The latest flush for the unmount cleanup, which must not capture a stale render.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // A newer server title (another tab, a reload) replaces the field only while the user
  // is neither in it nor holding unsaved text.
  useEffect(() => {
    if (!focused && unsaved.current === null) setValue(item.title);
  }, [item.title, focused]);

  const field = (
    <TaskTitlePresentation
      maxLength={500}
      aria-label={t("workItems:properties.titleLabel")}
      value={value}
      readOnly={readOnly || !canUpdateTasks()}
      placeholder={t("workItems:properties.titlePlaceholder")}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        flush();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        unsaved.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          if (unsaved.current !== null) save(unsaved.current);
        }, TITLE_SAVE_DELAY_MS);
      }}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {field}
      {failed ? (
        <p className="text-muted-foreground text-xs" role="alert">
          {t("workItems:properties.unsaved")}
        </p>
      ) : null}
    </div>
  );
}
