import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Kaneo's comment composer shell (`comment-input.tsx`): one rounded card holding the editor,
 * any staged files and a footer row. Both the original task composer and the work-item
 * composer render through it, so the two can never drift apart visually.
 */
export function CommentComposerPresentation({
  header,
  editor,
  attachments,
  footerStart,
  footerEnd,
  tinted = false,
  className,
  ...props
}: {
  /** Optional header strip above the editor (e.g. reply vs internal note mode bar). */
  header?: ReactNode;
  editor: ReactNode;
  /** Staged files, between the editor and the footer. */
  attachments?: ReactNode;
  /** Left of the footer: pickers such as canned responses. */
  footerStart?: ReactNode;
  /** Right of the footer: attach and send. */
  footerEnd: ReactNode;
  /** Tints the composer surface for staff-only internal notes (F-11). */
  tinted?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"div">, "children" | "className">) {
  return (
    <div
      className={cn(
        "rounded-xl border transition-colors focus-within:border-ring/60 focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--ring)_20%,transparent)]",
        tinted
          ? "border-warning/32 bg-warning/4"
          : "border-border/80 bg-card/70",
        className,
      )}
      {...props}
    >
      {header ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2",
            tinted ? "border-warning/24" : "border-border/70",
          )}
        >
          {header}
        </div>
      ) : null}
      {editor}
      {attachments}
      <div
        className={cn(
          "flex items-center gap-2 border-t px-2 py-2",
          tinted ? "border-warning/24" : "border-border/70",
          footerStart ? "justify-between" : "justify-end",
        )}
      >
        {footerStart ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {footerStart}
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-2">{footerEnd}</div>
      </div>
    </div>
  );
}

/** Tailwind overrides that give the Kaneo editor its composer padding. */
export const COMMENT_COMPOSER_EDITOR_CLASS =
  "[&_.taskdesk-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.taskdesk-comment-editor-content_.ProseMirror]:max-h-none [&_.taskdesk-comment-editor-content_.ProseMirror]:overflow-visible [&_.taskdesk-comment-editor-content_.ProseMirror]:px-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pt-3 [&_.taskdesk-comment-editor-content_.ProseMirror]:pb-2";
