import { Upload } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** The element carrying this attribute is the drop and paste zone of one open work item. */
export const WORK_ITEM_INTAKE_SCOPE_ATTRIBUTE = "data-work-item-intake-scope";

/**
 * AT-10/AT-11: files dropped on, or pasted while focus is inside, the work item detail become
 * attachments of that item.
 *
 * Listeners sit on the detail container (the nearest `data-work-item-intake-scope` ancestor of
 * `anchorRef`), never on the document: the detail is also mounted in the side pane over the
 * board, list, calendar and gantt, and a file dropped on those must not attach to the open
 * item. It never competes with an editor either: Kaneo's comment and description editors
 * handle their own drop and paste (comment files stay staged in the composer) and call
 * `preventDefault`, which this ignores.
 */
export function useWorkItemFileIntake({
  enabled,
  onFiles,
  anchorRef,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  /** Any element inside the detail; its scope ancestor (or itself) is the zone. */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [bounds, setBounds] = useState<DOMRect>();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    const anchor = anchorRef.current;
    const zone =
      anchor?.closest<HTMLElement>(`[${WORK_ITEM_INTAKE_SCOPE_ATTRIBUTE}]`) ??
      anchor;
    if (!enabled || !zone) {
      setDragging(false);
      return;
    }
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (event.defaultPrevented || !carriesFiles(event)) return;
      depth += 1;
      setBounds(zone.getBoundingClientRect());
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      // Marking the drop as allowed also stops the browser from navigating to the file.
      if (carriesFiles(event)) event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (event.defaultPrevented || !carriesFiles(event)) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      event.preventDefault();
      if (files.length) onFilesRef.current(files);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      onFilesRef.current(files);
    };
    zone.addEventListener("dragenter", onEnter);
    zone.addEventListener("dragover", onOver);
    zone.addEventListener("dragleave", onLeave);
    zone.addEventListener("drop", onDrop);
    zone.addEventListener("paste", onPaste);
    return () => {
      zone.removeEventListener("dragenter", onEnter);
      zone.removeEventListener("dragover", onOver);
      zone.removeEventListener("dragleave", onLeave);
      zone.removeEventListener("drop", onDrop);
      zone.removeEventListener("paste", onPaste);
      setDragging(false);
    };
  }, [enabled, anchorRef]);

  return { dragging, bounds };
}

/** Drop target laid over the detail (and only the detail) while a file is dragged onto it. */
export function WorkItemFileDropOverlay({
  active,
  bounds,
}: {
  active: boolean;
  bounds?: DOMRect;
}) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div
      role="status"
      data-testid="work-item-drop-overlay"
      className="pointer-events-none fixed z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      style={
        bounds
          ? {
              top: bounds.top,
              left: bounds.left,
              width: bounds.width,
              height: bounds.height,
            }
          : { inset: 0 }
      }
    >
      <div className="flex items-center gap-2 rounded-xl border border-border border-dashed bg-card px-6 py-5 font-medium text-sm shadow-lg">
        <Upload className="size-4" />
        {t("workItems:detail.attachments.dropToAttach")}
      </div>
    </div>
  );
}
