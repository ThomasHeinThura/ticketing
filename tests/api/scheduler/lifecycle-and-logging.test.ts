import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  logTaskDeskMock,
  readJobConfigurationsMock,
  runScheduledJobWithHistoryMock,
  startJobRunWorkerMock,
} = vi.hoisted(() => ({
  logTaskDeskMock: vi.fn(),
  readJobConfigurationsMock: vi.fn(),
  runScheduledJobWithHistoryMock: vi.fn(),
  startJobRunWorkerMock: vi.fn((): (() => Promise<void>) => async () => {}),
}));

vi.mock(
  "../../../apps/api/src/instance/observability/runtime",
  async (importOriginal) => ({
    // Keep the real exports other modules in the scheduler import graph read at load time.
    ...(await importOriginal<
      typeof import("../../../apps/api/src/instance/observability/runtime")
    >()),
    logTaskDesk: logTaskDeskMock,
  }),
);

vi.mock("../../../apps/api/src/instance/jobs/runtime", () => ({
  readJobConfigurations: readJobConfigurationsMock,
  runScheduledJobWithHistory: runScheduledJobWithHistoryMock,
  startJobRunWorker: startJobRunWorkerMock,
}));

import {
  DEFAULT_SCHEDULER_SHUTDOWN_TIMEOUT_MS,
  initializeScheduler,
  liveRegisteredJobCatalog,
  refreshRegisteredJobConfiguration,
  registeredJobByName,
  registeredJobs,
  setSchedulerShutdownTimeoutForTest,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler/index";

describe("scheduler structured error logging and graceful in-flight drain", () => {
  beforeEach(() => {
    logTaskDeskMock.mockReset();
    readJobConfigurationsMock.mockReset();
    runScheduledJobWithHistoryMock.mockReset();
    startJobRunWorkerMock.mockReset();
    startJobRunWorkerMock.mockImplementation(() => async () => {});
    readJobConfigurationsMock.mockResolvedValue(new Map());
    setSchedulerShutdownTimeoutForTest(DEFAULT_SCHEDULER_SHUTDOWN_TIMEOUT_MS);
  });

  afterEach(async () => {
    setSchedulerShutdownTimeoutForTest(50);
    await shutdownScheduler();
    setSchedulerShutdownTimeoutForTest(DEFAULT_SCHEDULER_SHUTDOWN_TIMEOUT_MS);
  });

  it("logs structured jobs.failure warning when persisted cron override is malformed (API-1)", async () => {
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    logTaskDeskMock.mockClear();

    const originalJob = registeredJobByName("automation-schedule");
    expect(originalJob).toBeDefined();

    readJobConfigurationsMock.mockResolvedValueOnce(
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

    await refreshRegisteredJobConfiguration();

    expect(logTaskDeskMock).toHaveBeenCalledWith({
      module: "jobs",
      message: "jobs.failure",
      level: "warn",
      result: "degraded",
      traceId: "automation-schedule",
    });
    expect(registeredJobByName("automation-schedule")).toBe(originalJob);
  });

  it("logs structured jobs.failure error when reading job configurations fails (API-1)", async () => {
    initializeScheduler();
    await refreshRegisteredJobConfiguration();
    logTaskDeskMock.mockClear();

    readJobConfigurationsMock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(refreshRegisteredJobConfiguration()).resolves.toBeUndefined();

    expect(logTaskDeskMock).toHaveBeenCalledWith({
      module: "jobs",
      message: "jobs.failure",
      level: "error",
      result: "degraded",
    });
  });

  it("stops timers synchronously and awaits active in-flight job runs on shutdown (DO-6)", async () => {
    let resolveRun: (() => void) | undefined;
    runScheduledJobWithHistoryMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        }),
    );

    initializeScheduler();
    const job = registeredJobByName("automation-schedule") as unknown as {
      fn: () => Promise<void>;
    };
    expect(typeof job.fn).toBe("function");

    const activeRun = job.fn();
    let settled = false;
    const shutdownPromise = shutdownScheduler().then(() => {
      settled = true;
    });

    // Synchronous teardown happens immediately for callers not awaiting shutdown.
    expect(registeredJobs()).toHaveLength(0);
    expect(liveRegisteredJobCatalog()).toEqual([]);

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRun?.();
    await activeRun;
    await shutdownPromise;
    expect(settled).toBe(true);
  });

  it("awaits the manual dispatch drain within the scheduler shutdown", async () => {
    let finishManual: (() => void) | undefined;
    const manualDrain = new Promise<void>((resolve) => {
      finishManual = resolve;
    });
    const stop = vi.fn(() => manualDrain);
    startJobRunWorkerMock.mockReturnValueOnce(stop);
    initializeScheduler();
    let settled = false;
    const stopping = shutdownScheduler().then(() => {
      settled = true;
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(registeredJobs()).toHaveLength(0);
    await Promise.resolve();
    expect(settled).toBe(false);
    finishManual?.();
    await stopping;
    expect(settled).toBe(true);
  });

  it("bounds a stuck manual dispatch by the same shutdown timeout", async () => {
    startJobRunWorkerMock.mockReturnValueOnce(
      () => new Promise<void>(() => {}),
    );
    setSchedulerShutdownTimeoutForTest(25);
    initializeScheduler();
    await expect(shutdownScheduler()).resolves.toBeUndefined();
  });

  it("bounds shutdown wait with safety timeout when an in-flight job hangs (DO-6)", async () => {
    runScheduledJobWithHistoryMock.mockImplementationOnce(
      () => new Promise<void>(() => {}),
    );

    setSchedulerShutdownTimeoutForTest(25);
    initializeScheduler();
    const job = registeredJobByName("automation-schedule") as unknown as {
      fn: () => Promise<void>;
    };
    void job.fn();

    await expect(shutdownScheduler()).resolves.toBeUndefined();
  });
});
