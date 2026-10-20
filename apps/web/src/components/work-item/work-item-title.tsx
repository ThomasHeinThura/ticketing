import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useWorkItemFeedback } from "./work-item-feedback";
import { useSaveWorkItemFields, workItemDetailKey } from "./work-item-save";

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
}: {
  item: WorkItemDetailRow;
  onAccessLost: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { announce, reportConflict, clearConflict } = useWorkItemFeedback();
  const { canUpdateTasks } = useWorkspacePermission(item.workspaceId);
  const [value, setValue] = useState(item.title);
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text typed but not yet confirmed saved; null when the field matches the server.
  const unsaved = useRef<string | null>(null);

  const update = useSaveWorkItemFields(item, {
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
    if (!title || title === item.title) {
      if (unsaved.current === text) unsaved.current = null;
      setFailed(false);
      return;
    }
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
    // ui-exempt: kaneo's borderless title is a bare input styled as the page heading.
    <input
      aria-label={t("workItems:properties.titleLabel")}
      className="block h-auto w-full appearance-none border-0 bg-transparent p-0 font-heading font-semibold text-[2rem] text-foreground leading-[1.15] tracking-[-0.02em] outline-none placeholder:text-foreground"
      type="text"
      value={value}
      readOnly={!canUpdateTasks()}
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
