import type { Extensions } from "@tiptap/core";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor, {
  type CommentEditorSlashCommand,
} from "@/components/activity/comment-editor";
import {
  createCalloutSlashCommand,
  KbCallout,
} from "@/components/kb/agent/kb-editor-extensions";
import { cn } from "@/lib/cn";

const EMPTY_EXTENSIONS: Extensions = [];
const EMPTY_SLASH_COMMANDS: CommentEditorSlashCommand[] = [];

export type DocumentEditorProps = {
  /** The stored Tiptap document. Remount (React `key`) to load a different one. */
  documentValue: unknown;
  /** Called only for edits made after the person interacted with the editor;
   * Tiptap's own updates while it mounts and normalises never reach it. */
  onDocumentChange: (document: unknown) => void;
  ariaLabel: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean | "start" | "end";
  className?: string;
  /** Caller-owned nodes, e.g. none for Pages. Keep the array identity stable. */
  additionalExtensions?: Extensions;
  /** Caller-owned slash actions, e.g. the KB-only internal note and work-item
   * reference. Keep the array identity stable. */
  additionalSlashCommands?: CommentEditorSlashCommand[];
  /** Focus left the editor (not a move between its own controls, such as the slash menu). */
  onBlur?: () => void;
};

/**
 * The shared editor for long-form documents (Pages and KB articles): the comment
 * editor with document styling, the info callout and no uploads, mentions or
 * video embeds, because those surfaces cannot store them.
 */
export function DocumentEditor({
  documentValue,
  onDocumentChange,
  ariaLabel,
  placeholder,
  readOnly = false,
  disabled = false,
  autoFocus = false,
  className,
  additionalExtensions = EMPTY_EXTENSIONS,
  additionalSlashCommands = EMPTY_SLASH_COMMANDS,
  onBlur,
}: DocumentEditorProps) {
  const { t } = useTranslation();
  // Tiptap reports updates of its own while it mounts; only edits after an interaction count.
  const interacted = useRef(false);
  const onDocumentChangeRef = useRef(onDocumentChange);
  onDocumentChangeRef.current = onDocumentChange;
  const touch = () => {
    interacted.current = true;
  };

  const extensions = useMemo<Extensions>(
    () => [
      KbCallout,
      ...additionalExtensions.filter(
        (extension) => extension.name !== KbCallout.name,
      ),
    ],
    [additionalExtensions],
  );
  const slashCommands = useMemo<CommentEditorSlashCommand[]>(() => {
    const callout = createCalloutSlashCommand({
      callout: t("activity:comment.editor.slashCallout"),
      calloutSearch: t("activity:comment.editor.searchCallout"),
    });
    return [
      callout,
      ...additionalSlashCommands.filter((command) => command.id !== callout.id),
    ];
  }, [additionalSlashCommands, t]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only notes the first interaction
    <div
      className={cn("taskdesk-document-editor rounded-lg border", className)}
      onFocus={touch}
      onKeyDown={touch}
      onPointerDown={touch}
      onPaste={touch}
      onDrop={touch}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onBlur?.();
      }}
    >
      <CommentEditor
        value=""
        documentValue={documentValue}
        onDocumentChange={(document) => {
          if (!interacted.current) return;
          onDocumentChangeRef.current(document);
        }}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        autoFocus={autoFocus}
        enableMentions={false}
        allowEmbeds={false}
        showQuickAttachButton={false}
        contentClassName="taskdesk-document-editor-content"
        proseClassName="taskdesk-comment-editor-prose taskdesk-document-prose"
        additionalExtensions={extensions}
        additionalSlashCommands={slashCommands}
      />
    </div>
  );
}
