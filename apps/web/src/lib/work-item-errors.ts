import { HttpError } from "@/lib/http-error";

export class WorkItemVersionConflictError extends Error {
  constructor(
    public readonly assertedVersion: number,
    public readonly currentVersion: number,
  ) {
    super("The work item version changed");
    this.name = "WorkItemVersionConflictError";
  }
}

/**
 * `require-work-item-reach.ts` makes "not yours" and "not there" indistinguishable, so a
 * 404 from ANY work-item request -- including a mutation made after the caller lost reach
 * (decision log 2026-10-13: "A 404 from any work-item mutation shows the not-found state")
 * -- means the same thing: the item is gone or no longer reachable.
 */
export function isWorkItemAccessLost(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}
