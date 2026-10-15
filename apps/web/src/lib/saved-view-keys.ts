/**
 * Cache keys for the saved-view screens and the sidebar's pinned views. They live in their own
 * tiny module so the app shell can share them without importing the saved-view fetchers and
 * query code, which load only when a pinned view is actually read (G11).
 *
 * Every key that holds something the server answers per viewer -- the reachable list, a view,
 * its count -- carries the viewer's user id, so a second account on the same browser never
 * reads the first one's cache (search-and-saved-views.md: counts and pins are keyed by viewer
 * identity). The count also carries the view's `updatedAt`, so editing a view never shows the
 * old answer.
 */
export const savedViewKeys = {
  all: ["saved-views"] as const,
  list: (workspaceId: string | undefined, userId: string | undefined) =>
    ["saved-views", workspaceId, userId] as const,
  detail: (userId: string | undefined, id: string) =>
    ["saved-view", userId, id] as const,
  count: (
    userId: string | undefined,
    id: string,
    updatedAt: string | undefined,
  ) => ["saved-view-count", userId, id, updatedAt] as const,
  teamAudiences: (
    workspaceId: string | undefined,
    userId: string | undefined,
  ) => ["saved-view-team-audiences", workspaceId, userId] as const,
};
