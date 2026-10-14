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
] as const;

/** The route this applies to; keep in step with the HTML preload in `vite.config.ts`. */
export const WORK_LIST_PATH_PATTERN = /^\/agent\/projects\/[^/]+\/work\/?$/;
