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
      {visible ? (
        <span role="status" aria-live="polite" className="sr-only">
          {label}
        </span>
      ) : null}
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
