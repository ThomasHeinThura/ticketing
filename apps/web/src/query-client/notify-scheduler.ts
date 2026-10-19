import { notifyManager } from "@tanstack/react-query";

/**
 * TanStack defaults to setTimeout(0) for observer notifications. That hop
 * queues behind the next frame under CPU pressure, delaying optimistic updates
 * (for example task assignment) by one or two frames. A microtask keeps the
 * batching but commits the update before the browser renders the next frame.
 *
 * Production (`query-client/index.ts`) and the unit-test setup both call this,
 * so tests run under the same ordering as the shipped app.
 */
export function configureNotifyScheduler() {
  notifyManager.setScheduler(queueMicrotask);
}
