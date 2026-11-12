import {
  type ReactNode,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useDelayedPending } from "./use-delayed-pending";

function PendingMarker({
  onPending,
}: {
  onPending: (pending: boolean) => void;
}) {
  useLayoutEffect(() => {
    onPending(true);
    return () => onPending(false);
  }, [onPending]);
  return null;
}

/** Holds an in-screen Suspense fallback for the same minimum as query placeholders.
 * Children mount hidden during retention: do not measure or focus on mount.
 * Use data-autofocus for initial focus restored when content becomes visible. */
export function DelayedSuspense({
  children,
  fallback,
  immediate = false,
}: {
  children: ReactNode;
  fallback: ReactNode | ((visible: boolean) => ReactNode);
  immediate?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const onPending = useCallback((next: boolean) => setPending(next), []);
  const visible = useDelayedPending(pending);
  const content = useRef<HTMLDivElement>(null);
  const [hasAlert, setHasAlert] = useState(false);
  useLayoutEffect(() => {
    const node = content.current;
    if (!visible || !node) {
      setHasAlert(false);
      return;
    }
    const check = () =>
      setHasAlert(Boolean(node.querySelector('[role="alert"]')));
    if (pending) setHasAlert(false);
    else check();
    const observer = new MutationObserver(check);
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role"],
    });
    return () => observer.disconnect();
  }, [visible, pending]);
  const hold = visible && !hasAlert && !immediate;
  const wasHeld = useRef(false);
  useLayoutEffect(() => {
    const node = content.current;
    if (wasHeld.current && !hold && node) {
      const active = document.activeElement;
      const dialog = node.closest('[role="dialog"]');
      if (
        active === document.body ||
        node.contains(active) ||
        active === dialog
      ) {
        node
          .querySelector<HTMLElement>("[autofocus], [data-autofocus]")
          ?.focus();
      }
    }
    wasHeld.current = hold;
  }, [hold]);
  return (
    <>
      <div
        ref={content}
        style={hold ? { display: "none" } : { display: "contents" }}
      >
        <Suspense fallback={<PendingMarker onPending={onPending} />}>
          {children}
        </Suspense>
      </div>
      {(pending || visible) && !hasAlert && (!immediate || pending) ? (
        <div
          style={{
            display: "contents",
            visibility: visible ? "visible" : "hidden",
          }}
        >
          {typeof fallback === "function" ? fallback(visible) : fallback}
        </div>
      ) : null}
    </>
  );
}
