import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lines: [] as string[],
  readJobConfigurations: vi.fn(),
  runScheduledJobWithHistory: vi.fn(),
  startJobRunWorker: vi.fn((): (() => Promise<void>) => async () => {}),
}));

vi.mock("../../../apps/api/src/instance/jobs/runtime", () => ({
  readJobConfigurations: h.readJobConfigurations,
  runScheduledJobWithHistory: h.runScheduledJobWithHistory,
  startJobRunWorker: h.startJobRunWorker,
}));

// The REAL structured logger (its event validation included) writing to a capture sink.
vi.mock(
  "../../../apps/api/src/instance/observability/runtime",
  async (importOriginal) => {
    const { createTaskDeskLogger } = await import(
      "../../../apps/api/src/observability/logger"
    );
    const { defaultLogLevels } = await import(
      "../../../apps/api/src/observability/settings"
    );
    const logger = createTaskDeskLogger(defaultLogLevels(), new Set(), {
      write: (line: string) => {
        h.lines.push(line);
      },
    });
    return {
      ...(await importOriginal<
        typeof import("../../../apps/api/src/instance/observability/runtime")
      >()),
      logTaskDesk: (event: Parameters<typeof logger.log>[0]) =>
        logger.log(event),
    };
  },
);

import {
  initializeScheduler,
  liveRegisteredJobCatalog,
  refreshRegisteredJobConfiguration,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

const events = () =>
  h.lines.map((line) => JSON.parse(line) as Record<string, unknown>);

const INVALID = "not-a-valid-cron-pattern";
const configFor = (
  name: string,
  pattern: string,
  enabled: boolean,
  version: number,
) =>
  new Map([
    [
      name,
      {
        name,
        pattern,
        enabled,
        version,
        updatedAt: new Date(),
        updatedByPersonId: null,
      },
    ],
  ]);
type Configurations = ReturnType<typeof configFor> | Map<never, never>;
function deferred() {
  let resolve!: (value: Configurations) => void;
  const promise = new Promise<Configurations>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const catalogEntry = (name: string) =>
  liveRegisteredJobCatalog().find((job) => job.name === name);

describe("job configuration refresh failure logging", () => {
  beforeEach(() => {
    h.lines.length = 0;
    h.readJobConfigurations.mockReset();
    h.readJobConfigurations.mockResolvedValue(new Map());
  });

  afterEach(() => shutdownScheduler());

  it("logs a closed degraded event when the configuration read fails and keeps the last schedule", async () => {
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    const before = registeredJobByName("automation-schedule");
    const pattern = before?.getPattern();
    expect(before).toBeDefined();
    h.lines.length = 0;

    h.readJobConfigurations.mockRejectedValueOnce(
      new Error("db-host.internal password=hunter2"),
    );
    await expect(refreshRegisteredJobConfiguration()).resolves.toBeUndefined();

    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      module: "jobs",
      messageKey: "jobs.failure",
      level: 50,
      result: "degraded",
    });
    expect(events()[0]).not.toHaveProperty("errorClass");
    expect(h.lines.join("")).not.toContain("hunter2");
    expect(h.lines.join("")).not.toContain("db-host.internal");
    expect(registeredJobByName("automation-schedule")).toBe(before);
    expect(before?.getPattern()).toBe(pattern);
  });

  it("logs a closed warning for an invalid persisted cron and keeps the previous schedule", async () => {
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    const before = registeredJobByName("automation-schedule");
    const pattern = before?.getPattern();
    expect(before).toBeDefined();
    h.lines.length = 0;

    h.readJobConfigurations.mockResolvedValueOnce(
      new Map([
        [
          "automation-schedule",
          {
            name: "automation-schedule",
            pattern: "not-a-valid-cron-pattern",
            enabled: true,
            version: 2,
            updatedAt: new Date(),
            updatedByPersonId: null,
          },
        ],
      ]),
    );
    await expect(refreshRegisteredJobConfiguration()).resolves.toBeUndefined();

    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      module: "jobs",
      messageKey: "jobs.failure",
      level: 40,
      result: "degraded",
      traceId: "automation-schedule",
    });
    expect(events()[0]).not.toHaveProperty("errorClass");
    expect(h.lines.join("")).not.toContain("not-a-valid-cron-pattern");
    expect(registeredJobByName("automation-schedule")).toBe(before);
    expect(before?.getPattern()).toBe(pattern);
  });

  it("keeps an enabled running job and its catalog state when an invalid pattern arrives with enabled=false", async () => {
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    const before = registeredJobByName("automation-schedule");
    const pattern = before?.getPattern();
    expect(before?.isRunning()).toBe(true);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(true);
    h.lines.length = 0;

    h.readJobConfigurations.mockResolvedValue(
      configFor("automation-schedule", INVALID, false, 2),
    );
    await refreshRegisteredJobConfiguration();

    expect(registeredJobByName("automation-schedule")).toBe(before);
    expect(before?.getPattern()).toBe(pattern);
    expect(before?.isRunning()).toBe(true);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(true);
    expect(catalogEntry("automation-schedule")?.nextRunAt).not.toBeNull();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      messageKey: "jobs.failure",
      level: 40,
      result: "degraded",
      traceId: "automation-schedule",
    });
    expect(events()[0]).not.toHaveProperty("errorClass");

    // The same rejected override is not retried or logged again on every poll.
    await refreshRegisteredJobConfiguration();
    expect(events()).toHaveLength(1);

    // A later valid override is applied and the catalog follows it.
    h.readJobConfigurations.mockResolvedValue(
      configFor("automation-schedule", "0 4 * * *", false, 3),
    );
    await refreshRegisteredJobConfiguration();
    const replaced = registeredJobByName("automation-schedule");
    expect(replaced).not.toBe(before);
    expect(replaced?.getPattern()).toBe("0 4 * * *");
    expect(replaced?.isRunning()).toBe(false);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(false);
  });

  it("keeps a paused job and its catalog state when an invalid pattern arrives with enabled=true", async () => {
    h.readJobConfigurations.mockResolvedValue(
      configFor("automation-schedule", "0 4 * * *", false, 1),
    );
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    const before = registeredJobByName("automation-schedule");
    expect(before?.getPattern()).toBe("0 4 * * *");
    expect(before?.isRunning()).toBe(false);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(false);
    h.lines.length = 0;

    h.readJobConfigurations.mockResolvedValue(
      configFor("automation-schedule", INVALID, true, 2),
    );
    await refreshRegisteredJobConfiguration();

    expect(registeredJobByName("automation-schedule")).toBe(before);
    expect(before?.getPattern()).toBe("0 4 * * *");
    expect(before?.isRunning()).toBe(false);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(false);
    expect(catalogEntry("automation-schedule")?.nextRunAt).toBeNull();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      messageKey: "jobs.failure",
      level: 40,
      result: "degraded",
    });
  });

  it("still publishes configured state for a job this role does not own, without building a Cron", async () => {
    initializeScheduler("jobs");
    h.readJobConfigurations.mockResolvedValue(
      configFor("customer-invitation-delivery", INVALID, true, 2),
    );
    await refreshRegisteredJobConfiguration();
    expect(registeredJobByName("customer-invitation-delivery")).toBeUndefined();
    expect(catalogEntry("customer-invitation-delivery")?.enabled).toBe(true);
    expect(events()).toEqual([]);

    h.readJobConfigurations.mockResolvedValue(
      configFor("customer-invitation-delivery", "0 4 * * *", false, 3),
    );
    await refreshRegisteredJobConfiguration();
    expect(catalogEntry("customer-invitation-delivery")?.enabled).toBe(false);
    expect(events()).toEqual([]);
  });

  it("serialises overlapping refreshes: a slow older read cannot overwrite a newer configuration", async () => {
    const older = deferred();
    const newer = deferred();
    const configB = configFor("automation-schedule", "0 4 * * *", false, 2);
    h.readJobConfigurations
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
      .mockResolvedValue(configB);

    initializeScheduler(); // startup refresh: its read (A) is still pending
    const second = refreshRegisteredJobConfiguration();
    await flush();
    // One read in flight; the second refresh waits instead of reading concurrently.
    expect(h.readJobConfigurations).toHaveBeenCalledTimes(1);

    newer.resolve(configB);
    older.resolve(configFor("automation-schedule", "0 3 * * *", true, 1));
    await second;
    await flush();

    // The older read applied first, then the follow-up read applied the newest (B).
    expect(h.readJobConfigurations).toHaveBeenCalledTimes(2);
    const job = registeredJobByName("automation-schedule");
    expect(job?.getPattern()).toBe("0 4 * * *");
    expect(job?.isRunning()).toBe(false);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(false);
  });

  it("makes progress while one read outlasts several polls: one follow-up read, then the newest wins", async () => {
    const slow = deferred();
    h.readJobConfigurations
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue(
        configFor("automation-schedule", "0 4 * * *", false, 2),
      );

    initializeScheduler();
    const polls = [
      refreshRegisteredJobConfiguration(),
      refreshRegisteredJobConfiguration(),
      refreshRegisteredJobConfiguration(),
    ];
    await flush();
    expect(h.readJobConfigurations).toHaveBeenCalledTimes(1);

    slow.resolve(new Map());
    await Promise.all(polls);
    await flush();

    expect(h.readJobConfigurations).toHaveBeenCalledTimes(2);
    expect(registeredJobByName("automation-schedule")?.getPattern()).toBe(
      "0 4 * * *",
    );
    expect(catalogEntry("automation-schedule")?.enabled).toBe(false);
  });

  it("a read still pending from a shut-down lifecycle neither blocks nor affects the restarted one", async () => {
    const stale = deferred();
    h.readJobConfigurations.mockImplementationOnce(() => stale.promise);
    initializeScheduler(); // old lifecycle: read pending
    const pattern = registeredJobByName("automation-schedule")?.getPattern();
    await shutdownScheduler();

    h.readJobConfigurations.mockResolvedValue(new Map());
    initializeScheduler(); // new lifecycle must start its own read immediately
    await vi.waitFor(() =>
      expect(h.readJobConfigurations).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(catalogEntry("automation-schedule")?.enabled).toBe(true),
    );
    const current = registeredJobByName("automation-schedule");
    expect(current?.isRunning()).toBe(true);

    stale.resolve(configFor("automation-schedule", "0 5 * * *", false, 9));
    await flush();

    expect(registeredJobByName("automation-schedule")).toBe(current);
    expect(current?.getPattern()).toBe(pattern);
    expect(current?.isRunning()).toBe(true);
    expect(catalogEntry("automation-schedule")?.enabled).toBe(true);
    // A refresh after the stale read settled still works (its flight did not stick).
    await refreshRegisteredJobConfiguration();
    expect(h.readJobConfigurations.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("warns again when an invalid override reappears after the previous valid signature was restored exactly", async () => {
    const valid = configFor("automation-schedule", "0 4 * * *", false, 1);
    const invalid = configFor("automation-schedule", INVALID, true, 2);
    h.readJobConfigurations.mockResolvedValue(valid);
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    h.lines.length = 0;

    for (const next of [invalid, valid, invalid, invalid]) {
      h.readJobConfigurations.mockResolvedValue(next);
      await refreshRegisteredJobConfiguration();
    }

    // B -> A(invalid) -> B (same version) -> A(invalid) -> A(invalid): two introductions, the repeat is suppressed.
    expect(events()).toHaveLength(2);
    expect(registeredJobByName("automation-schedule")?.getPattern()).toBe(
      "0 4 * * *",
    );
  });

  it("does not leave an unhandled rejection when the initial, un-awaited refresh fails", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      h.readJobConfigurations.mockRejectedValue(new Error("db unavailable"));
      initializeScheduler();
      await vi.waitFor(() => expect(events()).toHaveLength(1));
      // Give a rejected, un-awaited promise the chance to surface.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(events()[0]).toMatchObject({
        messageKey: "jobs.failure",
        level: 50,
        result: "degraded",
      });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
