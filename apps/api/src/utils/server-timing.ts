/**
 * Phase timings for one request, sent as a `Server-Timing` response header so slow reads can
 * be diagnosed from the browser's network panel on any deployment without a debug flag. Only
 * phase names and durations are sent: no identifiers, query text or data.
 */
export class ServerTiming {
  private readonly phases: Array<{ name: string; durationMs: number }> = [];
  private readonly startedAt = performance.now();

  /** Runs `work` and records how long it took under `name`, even when it throws. */
  async measure<T>(name: string, work: () => PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.phases.push({ name, durationMs: performance.now() - start });
    }
  }

  /** The header value: every recorded phase, then `total` since this timer was created. */
  header(): string {
    return [
      ...this.phases,
      { name: "total", durationMs: performance.now() - this.startedAt },
    ]
      .map(({ name, durationMs }) => `${name};dur=${durationMs.toFixed(1)}`)
      .join(", ");
  }
}
