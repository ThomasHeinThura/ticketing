import { useEffect, useRef, useState } from "react";

/** Delay a loading indicator and keep it visible briefly once shown. Callers must
 * render errors immediately, even while the indicator is being retained. */
export function useDelayedPending(
  pending: boolean,
  {
    releaseNow = false,
    delayMs = 150,
    minVisibleMs = 300,
  }: {
    releaseNow?: boolean;
    delayMs?: number;
    minVisibleMs?: number;
  } = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (releaseNow) {
      shownAt.current = null;
      setVisible(false);
      return;
    }
    if (pending) {
      if (shownAt.current !== null) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    if (shownAt.current === null) return;
    const remaining = Math.max(
      0,
      minVisibleMs - (Date.now() - shownAt.current),
    );
    const timer = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [pending, releaseNow, delayMs, minVisibleMs]);

  return visible && !releaseNow;
}
