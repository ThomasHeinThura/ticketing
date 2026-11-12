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

/** Holds an in-screen Suspense fallback for the same minimum as query placeholders. */
export function DelayedSuspense({
  children,
  fallback,
  immediate = false,
}: {
  children: ReactNode;
  fallback: ReactNode;
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
  return (
    <>
      <div ref={content} style={{ display: hold ? "none" : "contents" }}>
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
          {fallback}
        </div>
      ) : null}
    </>
  );
}
