/**
 * Namespaces the work-list route paints with: the application shell (`common`, `navigation`)
 * and the work-item screen itself. A direct visit to that route loads only these before first
 * paint and the remaining namespaces after it (G11). A string used on the first paint of the
 * route and missing from this list would render as its raw key until the second group lands,
 * so `work-route-namespaces.test.ts` pins the contents against the catalog.
 */
export const WORK_ROUTE_I18N_NAMESPACES = [
  "common",
  "navigation",
  "workItems",
  "tasks",
] as const;

/** The route this applies to; keep in step with the HTML preload in `vite.config.ts`. */
export const WORK_LIST_PATH_PATTERN = /^\/agent\/projects\/[^/]+\/work\/?$/;

/**
 * Modules that are part of the work route's first-paint chunks and still refer to a deferred
 * namespace, with the namespaces they may refer to. The build fails for any other module (see
 * `findDeferredNamespaceUsers`), so adding a deferred-namespace string to a first-paint screen
 * is a deliberate decision: either move the namespace into the first-paint group, or add the
 * module here with the reason it cannot paint before the deferred group lands.
 */
export const DEFERRED_NAMESPACE_ALLOWLIST: Readonly<
  Record<string, readonly string[]>
> = {
  // Renders nothing until `useTranslation(..).ready` reports the namespace loaded, and only
  // after an impersonation status request resolves, so it can never paint raw keys.
  "/components/god-mode/impersonation-banner.tsx": ["instanceUsers"],
  // The bulk cycle/module/estimate actions are part of the bulk toolbar, which appears only after
  // the user selects work items, long after the deferred group has landed.
  "/components/agile/bulk-agile-actions.tsx": ["agile"],
  "/components/agile/bulk-agile-dialog.tsx": ["agile"],
};
