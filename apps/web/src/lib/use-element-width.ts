import { useCallback, useEffect, useRef, useState } from "react";

export type ElementSize = { width: number; height: number };

/**
 * The rendered size of an element, in CSS pixels, kept current with a ResizeObserver. Attach
 * `measureRef` to the element. `size` is `null` until the element is measured, and stays `null`
 * where ResizeObserver is missing, so a caller picks its own fallback.
 */
export function useElementSize(): {
  size: ElementSize | null;
  measureRef: (element: HTMLElement | null) => void;
} {
  const [size, setSize] = useState<ElementSize | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((element: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = (width: number, height: number) =>
      setSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { width, height },
      );
    const box = element.getBoundingClientRect();
    update(box.width, box.height);
    const next = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    next.observe(element);
    observer.current = next;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { size, measureRef };
}

/** The rendered width of an element (see `useElementSize`); `null` until measured. */
export function useElementWidth(): {
  width: number | null;
  measureRef: (element: HTMLElement | null) => void;
} {
  const { size, measureRef } = useElementSize();
  return { width: size?.width ?? null, measureRef };
}
