import { Separator } from "@taskdesk/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const MIN_WIDTH = 64;
const MAX_WIDTH = 800;
const KEYBOARD_STEP = 8;
const KEYBOARD_LARGE_STEP = 32;

type Props = {
  label: string;
  currentWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  direction?: "normal" | "reverse";
  stretch?: boolean;
  scopeKey?: string;
  disabled?: boolean;
  onPreview: (width: number) => void;
  onCommit: (width: number, originalWidth: number) => void | Promise<void>;
  onCancel: (originalWidth: number) => void;
};

type ActiveResize = {
  pointerId: number;
  startX: number;
  originalWidth: number;
  width: number;
};

function clampWidth(width: number, minWidth = MIN_WIDTH, maxWidth = MAX_WIDTH) {
  return Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
}

function measuredColumnWidth(
  element: HTMLElement,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
) {
  const header = element.closest<HTMLElement>("th");
  return clampWidth(
    header?.getBoundingClientRect().width ?? minWidth,
    minWidth,
    maxWidth,
  );
}

/** Keyboard and pointer resize semantics for Kaneo table columns. */
export default function WorkItemColumnResizeHandle({
  label,
  currentWidth,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
  direction = "normal",
  stretch = false,
  scopeKey,
  disabled = false,
  onPreview,
  onCommit,
  onCancel,
}: Props) {
  const handleRef = useRef<HTMLDivElement>(null);
  const active = useRef<ActiveResize | undefined>(undefined);
  const escapeListener = useRef<((event: KeyboardEvent) => void) | undefined>(
    undefined,
  );
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const previousScopeKey = useRef(scopeKey);
  const [width, setWidth] = useState(currentWidth ?? MIN_WIDTH);
  const directionFactor = direction === "reverse" ? -1 : 1;

  const removeEscapeListener = useCallback(() => {
    if (!escapeListener.current) return;
    document.removeEventListener("keydown", escapeListener.current, true);
    escapeListener.current = undefined;
  }, []);

  useEffect(
    () => () => {
      removeEscapeListener();
      const resize = active.current;
      active.current = undefined;
      if (!resize) return;
      try {
        handleRef.current?.releasePointerCapture?.(resize.pointerId);
      } catch {
        // The capture may already have been released by the browser.
      }
      onCancelRef.current(clampWidth(resize.originalWidth, minWidth, maxWidth));
    },
    [maxWidth, minWidth, removeEscapeListener],
  );

  useLayoutEffect(() => {
    if (currentWidth !== undefined) {
      setWidth(clampWidth(currentWidth, minWidth, maxWidth));
      return;
    }
    if (handleRef.current)
      setWidth(measuredColumnWidth(handleRef.current, minWidth, maxWidth));
  }, [currentWidth, maxWidth, minWidth]);

  useLayoutEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    const resize = active.current;
    if (resize) {
      removeEscapeListener();
      active.current = undefined;
      try {
        handleRef.current?.releasePointerCapture?.(resize.pointerId);
      } catch {
        // The capture may already have been released by the browser.
      }
      onCancelRef.current(clampWidth(resize.originalWidth, minWidth, maxWidth));
    }
    if (currentWidth !== undefined)
      setWidth(clampWidth(currentWidth, minWidth, maxWidth));
    else if (handleRef.current)
      setWidth(measuredColumnWidth(handleRef.current, minWidth, maxWidth));
  }, [currentWidth, maxWidth, minWidth, removeEscapeListener, scopeKey]);

  const update = (nextWidth: number) => {
    const next = clampWidth(nextWidth, minWidth, maxWidth);
    setWidth(next);
    onPreview(next);
    return next;
  };

  const cancel = (originalWidth: number) => {
    const resize = active.current;
    removeEscapeListener();
    if (resize) {
      try {
        handleRef.current?.releasePointerCapture?.(resize.pointerId);
      } catch {
        // The capture may already have been released by the browser.
      }
    }
    active.current = undefined;
    setWidth(clampWidth(originalWidth, minWidth, maxWidth));
    onCancel(clampWidth(originalWidth, minWidth, maxWidth));
  };

  const commit = (nextWidth: number, originalWidth: number) => {
    removeEscapeListener();
    active.current = undefined;
    const next = clampWidth(nextWidth, minWidth, maxWidth);
    setWidth(next);
    if (next === clampWidth(originalWidth, minWidth, maxWidth)) {
      onCancel(clampWidth(originalWidth, minWidth, maxWidth));
      return;
    }
    try {
      const result = onCommit(
        next,
        clampWidth(originalWidth, minWidth, maxWidth),
      );
      if (result && typeof result.then === "function")
        void result.catch(() => cancel(originalWidth));
    } catch {
      cancel(originalWidth);
    }
  };

  return (
    <Separator
      ref={handleRef}
      orientation="vertical"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={clampWidth(width, minWidth, maxWidth)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-testid="work-item-column-resize-handle"
      className={`relative z-10 data-[orientation=vertical]:w-3 cursor-col-resize touch-none bg-transparent before:absolute before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border hover:before:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${stretch ? "h-full before:top-0 before:h-full" : "h-7 before:top-1 before:h-5"}`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const startWidth =
          currentWidth === undefined
            ? measuredColumnWidth(event.currentTarget, minWidth, maxWidth)
            : clampWidth(currentWidth, minWidth, maxWidth);
        setWidth(startWidth);
        active.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          originalWidth: startWidth,
          width: startWidth,
        };
        removeEscapeListener();
        const resize = active.current;
        const onDocumentKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape" || active.current !== resize) return;
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          cancel(resize.originalWidth);
        };
        escapeListener.current = onDocumentKeyDown;
        document.addEventListener("keydown", onDocumentKeyDown, true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const resize = active.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        resize.width = update(
          resize.originalWidth +
            (event.clientX - resize.startX) * directionFactor,
        );
      }}
      onPointerUp={(event) => {
        const resize = active.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const next = clampWidth(
          resize.originalWidth +
            (event.clientX - resize.startX) * directionFactor,
          minWidth,
          maxWidth,
        );
        try {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        } catch {
          // The pointer may already have been released by the browser.
        }
        commit(next, resize.originalWidth);
      }}
      onPointerCancel={(event) => {
        const resize = active.current;
        if (!resize || resize.pointerId !== event.pointerId) return;
        event.stopPropagation();
        cancel(resize.originalWidth);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Escape" && active.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel(active.current.originalWidth);
          return;
        }
        const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
        const measured =
          currentWidth ??
          (handleRef.current
            ? measuredColumnWidth(handleRef.current, minWidth, maxWidth)
            : width);
        const current = clampWidth(width || measured, minWidth, maxWidth);
        const next =
          event.key === "ArrowLeft"
            ? clampWidth(current - step * directionFactor, minWidth, maxWidth)
            : event.key === "ArrowRight"
              ? clampWidth(current + step * directionFactor, minWidth, maxWidth)
              : event.key === "Home"
                ? minWidth
                : event.key === "End"
                  ? maxWidth
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const original = current;
        update(next);
        commit(next, original);
      }}
    />
  );
}

export {
  MAX_WIDTH as WORK_ITEM_COLUMN_MAX_WIDTH,
  MIN_WIDTH as WORK_ITEM_COLUMN_MIN_WIDTH,
};
