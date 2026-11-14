import type { ReactNode } from "react";

/** Announce only after the delayed placeholder is visible. */
export function LoadingStatus({
  children,
  label,
  visible,
}: {
  children: ReactNode;
  label: string;
  visible: boolean;
}) {
  return (
    <>
      <span
        role="status"
        aria-live="polite"
        aria-label={visible ? label : undefined}
        className="sr-only"
        style={{ fontFamily: "sans-serif" }}
      >
        {visible ? label : null}
      </span>
      <div
        aria-hidden="true"
        style={{
          display: "contents",
          visibility: visible ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}
