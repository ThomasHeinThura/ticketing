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
  "term",
] as const;

/** The route this applies to; keep in step with the HTML preload in `vite.config.ts`. */
export const WORK_LIST_PATH_PATTERN = /^\/agent\/projects\/[^/]+\/work\/?$/;

/**
 * Work-route modules rendered before any namespace boundary (the board layout and the side-pane
 * shell). The build adds their chunks' static closures to the first-paint set the guard scans.
 */
export const WORK_ROUTE_BOUNDARY_FREE_MODULES = [
  "/components/work-item/work-item-board.tsx",
  "/components/work-item/work-item-side-pane.tsx",
] as const;

/**
 * Namespaces split out of the first-paint ones to keep the work list small. Like every deferred
 * namespace, a read of them on the work route or shell must sit behind a namespace boundary (or
 * be allowlisted below with a reason); the render-graph guard fails the build otherwise.
 */
export const SPLIT_OUT_NAMESPACES = ["tasksExtra", "workItemsExtra"] as const;

/**
 * Import edges into screens that render only on other paths. `routes/agent/__root.tsx`
 * (beforeLoad) awaits `whenAllNamespacesLoaded()` for every path except the work list, so these
 * screens cannot paint before the deferred group lands. The render-graph guard skips an edge only
 * when BOTH the importing module and the screen match; any other importer of the screen is still
 * followed. (The command palette's `void import` of projects-page is a preload and is already
 * ignored.) Removing the root gate means removing this list.
 */
export const WORK_ROUTE_NON_WORK_SCREENS = [
  {
    importer: "/main.tsx",
    target: "/components/agent-not-found.tsx",
  },
  {
    importer: "/routes/agent/_layout/_authenticated/agent.tsx",
    target: "/components/project-list/projects-page.tsx",
  },
  {
    importer:
      "/routes/agent/_layout/_authenticated/agent/projects/$projectKey.tsx",
    target: "/components/project/overview/project-overview-page.tsx",
  },
] as const;

/** Entry points of the agent work route and shell render graph (relative to `apps/web/src`). */
export const WORK_ROUTE_RENDER_ROOTS = [
  "main.tsx",
  "routes/agent/__root.tsx",
  "routes/agent/_layout.tsx",
  "routes/agent/_layout/_authenticated.tsx",
  "routes/agent/_layout/_authenticated/agent.tsx",
  "routes/agent/_layout/_authenticated/agent/projects/$projectKey.tsx",
  "routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx",
] as const;

/**
 * Optional surfaces that read the split-out namespaces. Each is rendered inside the shared
 * `NamespaceBoundary` by its importer, so it can never paint before the deferred group lands.
 * The render-graph guard stops at an import into one of these only when the importer renders the
 * boundary; strip the boundary and the surface's reads fail the build.
 */
export const WORK_ROUTE_GATED_SURFACES = [
  "/components/work-item/work-item-side-pane-body.tsx",
  "/components/work-item/work-item-context-menu-content.tsx",
  "/components/pending-action/pending-action-approval.tsx",
  "/components/work-item/create-work-item-dialog-form.tsx",
  "/components/task/task-details-sheet-body.tsx",
  "/components/notification/notification-menu.tsx",
  "/components/notification/notification-clear-dialog.tsx",
  "/components/shared/modals/create-workspace-modal.tsx",
] as const;

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
  // A post-action toast after a failed drag-reorder, with a `common` error string as its fallback.
  "/components/nav-projects-sortable.tsx": ["workspace"],
  // The two reads are the toasts after the user confirms inside the approval, which sits behind
  // its own namespace boundary in this module.
  "/components/pending-action/pending-action-approval-dialog.tsx": [
    "pendingActions",
  ],
  // The shell imports only `isForbiddenError`; the `settings` strings are in the access-denied
  // components, which render on settings routes (gated by the root route).
  "/components/settings/settings-access.tsx": ["settings"],
  // The keys are the fallback message of a failed holiday import, which the user triggers.
  "/fetchers/service-calendar.ts": ["serviceCalendars"],
};
