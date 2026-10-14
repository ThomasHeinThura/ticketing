/**
 * Marker attached to every reach middleware (`requireWorkItemReach`, `requireAttachmentReach`,
 * `workspaceAccess.*`) so `tests/permissions/work-item-reach-guard.test.ts` can read, from the
 * real router, whether a route resolves PROJECT reach. Never read at runtime.
 */
export const WORK_ITEM_REACH_MARK = Symbol.for("taskdesk.workItemReach");

export type WorkItemReachMark = {
  readonly projectReach: boolean;
  readonly workspaceReachOnlyReason?: string;
  /**
   * The persisted resource kinds a `workspaceAccess.*` lookup resolves from the request
   * (`project`, `task`, `column`, ...). Lets `project-reach-guard.test.ts` derive, from the
   * real router, which routes act on a project or a task, rather than trusting a hand-kept
   * list alone.
   */
  readonly resources?: readonly string[];
};

/** Attach a reach mark to a hand-written middleware (keeps every mark set the same way). */
export function markReach<T extends (...args: never[]) => unknown>(
  middleware: T,
  mark: WorkItemReachMark,
): T & { readonly [WORK_ITEM_REACH_MARK]: WorkItemReachMark } {
  return Object.assign(middleware, { [WORK_ITEM_REACH_MARK]: mark });
}
