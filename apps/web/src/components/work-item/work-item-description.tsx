import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  isWorkItemAccessLost,
  WorkItemVersionConflictError,
} from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { useWorkItemFeedback } from "./work-item-feedback";
import {
  cachedWorkItem,
  isSameJson,
  useSaveWorkItemFields,
  workItemDetailKey,
} from "./work-item-save";

export const DESCRIPTION_SAVE_DELAY_MS = 1000;

/** Kaneo's description editor classes (`task-description-editor.tsx`). */
const EDITOR_CLASS =
  "[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[11rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-0 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-1 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-2";

const NOTHING_SAVED = Symbol("nothing-saved");

/**
 * The work item's description in kaneo's editor. Work items store the editor's Tiptap
 * document (`work_item.description` jsonb), so the document is saved, after a pause, with
 * the item's version. A legacy plain-text description opens as text and is saved back as
 * a document on the first edit.
 *
 * The editor is fed a held copy of the server value, not the live one: a refetch only
 * replaces what the user sees when they are neither in the editor nor holding unsaved
 * text, and never when it is the echo of our own save (that would wipe text typed during
 * the round trip). A version conflict resets the editor to the server's description; any
 * other failure keeps the text, says it is not saved, and tries again on blur. A pending
 * save is flushed on blur and on unmount.
 */
export default function WorkItemDescription({
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
  const [shown, setShown] = useState<unknown>(item.description);
  // Bumped to remount the editor on the server's value after a conflict.
  const [generation, setGeneration] = useState(0);
  // Whether the user has touched this editor instance. Tiptap reports updates of its own
  // while it mounts (an empty document before the stored one is loaded); saving those
  // would blank the description, so only changes after an interaction are edits.
  const interacted = useRef(false);
  const markInteracted = () => {
    interacted.current = true;
  };
  const [focused, setFocused] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The document typed but not yet confirmed saved.
  const unsaved = useRef<unknown>(NOTHING_SAVED);
  // The document of our last save, to recognise its echo in a refetch.
  const lastSaved = useRef<unknown>(NOTHING_SAVED);
  // The document of the save in flight: a blur right after the pause must not resend it.
  const inFlight = useRef<unknown>(NOTHING_SAVED);
  const pendingWrites = useRef(0);

  const update = useSaveWorkItemFields(item, {
    onSettled: () => {
      pendingWrites.current -= 1;
      if (pendingWrites.current === 0) inFlight.current = NOTHING_SAVED;
    },
    onError: async (error) => {
      if (isWorkItemAccessLost(error)) {
        onAccessLost();
        return;
      }
      if (error instanceof WorkItemVersionConflictError) {
        unsaved.current = NOTHING_SAVED;
        lastSaved.current = NOTHING_SAVED;
        setFailed(false);
        reportConflict();
        await queryClient.refetchQueries({
          queryKey: workItemDetailKey(item.key),
        });
        const latest = queryClient.getQueryData<WorkItemDetailRow>(
          workItemDetailKey(item.key),
        );
        setShown(latest ? latest.description : item.description);
        interacted.current = false;
        setGeneration((current) => current + 1);
        return;
      }
      setFailed(true);
    },
  });

  const save = (document: unknown) => {
    if (
      pendingWrites.current === 0 &&
      isSameJson(document, cachedWorkItem(queryClient, item).description)
    ) {
      if (unsaved.current === document) unsaved.current = NOTHING_SAVED;
      setFailed(false);
      return;
    }
    // Already on its way; its answer clears `unsaved`.
    if (
      inFlight.current !== NOTHING_SAVED &&
      isSameJson(document, inFlight.current)
    )
      return;
    inFlight.current = document;
    pendingWrites.current += 1;
    lastSaved.current = document;
    update.mutate(
      { description: document },
      {
        onSuccess: () => {
          if (unsaved.current === document) unsaved.current = NOTHING_SAVED;
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
    if (unsaved.current !== NOTHING_SAVED) save(unsaved.current);
  };

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // Runs when the server's description changes or the user leaves the editor.
  useEffect(() => {
    if (focused || unsaved.current !== NOTHING_SAVED) return;
    // Our own save coming back: the editor already shows it (or newer text).
    if (
      lastSaved.current !== NOTHING_SAVED &&
      isSameJson(item.description, lastSaved.current)
    )
      return;
    setShown(item.description);
  }, [item.description, focused]);

  const isDocument = typeof shown === "object" && shown !== null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus tracking for the editor inside, not an interaction of its own
    <div
      className="flex flex-col gap-1"
      onFocus={() => {
        markInteracted();
        setFocused(true);
      }}
      onPointerDown={markInteracted}
      onKeyDown={markInteracted}
      onPaste={markInteracted}
      onDrop={markInteracted}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setFocused(false);
        flush();
      }}
    >
      <CommentEditor
        key={generation}
        value={typeof shown === "string" ? shown : ""}
        documentValue={isDocument ? shown : undefined}
        onDocumentChange={(document) => {
          if (!interacted.current) return;
          unsaved.current = document;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            if (unsaved.current !== NOTHING_SAVED) save(unsaved.current);
          }, DESCRIPTION_SAVE_DELAY_MS);
        }}
        readOnly={!canUpdateTasks()}
        placeholder={t("tasks:detail.addDescription")}
        className={EDITOR_CLASS}
      />
      {failed ? (
        <p className="text-muted-foreground text-xs" role="alert">
          {t("workItems:properties.unsaved")}
        </p>
      ) : null}
    </div>
  );
}
