import { WORK_LIST_PATH_PATTERN } from "@/lib/i18n/work-route-namespaces";

/**
 * How long a direct visit's first paint may wait for the list's rows. The G13 work-list sample
 * delays each read by 250 ms (two in a row before the rows), so its loading state still shows.
 */
export const WORK_LIST_FIRST_PAINT_WAIT_MS = 300;

let directVisitPending =
  typeof window !== "undefined" &&
  WORK_LIST_PATH_PATTERN.test(window.location.pathname);

/**
 * The work route's loader on the document's first entry into the grouped list: waits, at most
 * `WORK_LIST_FIRST_PAINT_WAIT_MS`, for the reads `prefetchWorkListData` started, so the shell and
 * the preview rows render and paint together. Rendering first painted the loading state, then
 * rendered and laid the page out again for the rows: that second pass, not the reads, was the
 * largest part of the time to the rows (G11 work-list LCP).
 *
 * Returns nothing, so the route renders at once, on a search change ("stay"), without reads, on
 * later entries and when the page was opened elsewhere. Never rejects.
 */
export function waitForWorkListFirstPaint({
  cause,
  reads,
}: {
  cause: "enter" | "stay" | "preload";
  reads: Promise<void> | undefined;
}): Promise<void> | undefined {
  if (!directVisitPending || cause === "stay" || !reads) return;
  if (cause === "enter") directVisitPending = false;
  return new Promise<void>((resolve) => {
    // Settled once, the first paint has its rows or has stopped waiting for them; the entry
    // may reuse the direct-visit preload's loader, so this, not only an entry, ends the visit.
    const done = () => {
      directVisitPending = false;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, WORK_LIST_FIRST_PAINT_WAIT_MS);
    void reads.then(done, done);
  });
}
