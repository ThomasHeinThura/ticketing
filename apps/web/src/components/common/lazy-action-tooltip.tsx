import { lazy, type ReactElement, Suspense } from "react";

const ActionTooltip = lazy(() =>
  import("./action-tooltip").then((module) => ({
    default: module.ActionTooltip,
  })),
);

/**
 * ActionTooltip for screens inside the work-list initial route graph (G11 bundle budget).
 * The tooltip code loads after first paint; until then the control renders on its own, with
 * its accessible name unchanged.
 */
export function LazyActionTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Suspense fallback={children}>
      <ActionTooltip label={label}>{children}</ActionTooltip>
    </Suspense>
  );
}
