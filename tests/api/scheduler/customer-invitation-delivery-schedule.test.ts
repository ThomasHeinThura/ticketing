import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), manualWorker: vi.fn() }));
vi.mock("../../../apps/api/src/customer-invitation/delivery/worker", () => ({
  runCustomerInvitationDeliveryJob: mocks.deliver,
}));
vi.mock("../../../apps/api/src/instance/jobs/runtime", () => ({
  readJobConfigurations: async (names: string[]) =>
    new Map(
      names.map((name) => [
        name,
        {
          name,
          pattern: null,
          enabled: name === "customer-invitation-delivery",
          version: 1,
        },
      ]),
    ),
  runScheduledJobWithHistory: async (
    _name: string,
    run: () => Promise<unknown>,
  ) => run(),
  startJobRunWorker: mocks.manualWorker,
}));

import {
  initializeScheduler,
  registeredJobByName,
  registeredJobCatalog,
  registeredJobs,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";

afterEach(() => {
  shutdownScheduler();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("runs the minute clock while refusing manual admission and keeping rekey on demand", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00.000Z"));
  mocks.deliver.mockResolvedValue({
    claimed: 0,
    sent: 0,
    failed: 0,
    degraded: false,
  });
  mocks.manualWorker.mockReturnValue(vi.fn());
  initializeScheduler();
  await vi.advanceTimersByTimeAsync(0);
  const queue = registeredJobCatalog().find(
    (job) => job.name === "customer-invitation-delivery",
  );
  expect(queue).toMatchObject({
    defaultPattern: "* * * * *",
    manualRunAllowed: false,
    enabled: true,
  });
  expect(queue?.nextRunAt).toBeInstanceOf(Date);
  const resolveManual = mocks.manualWorker.mock.calls[0]?.[0] as (
    name: string,
  ) => unknown;
  expect(resolveManual("customer-invitation-delivery")).toBeUndefined();
  expect(
    registeredJobCatalog().find((job) => job.name === "secrets-rekey"),
  ).toMatchObject({
    defaultPattern: null,
    nextRunAt: null,
    manualRunAllowed: false,
  });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.deliver).toHaveBeenCalledTimes(1);
});

it("keeps the full catalog on web while scheduling only its invitation poller", async () => {
  vi.useFakeTimers();
  mocks.manualWorker.mockReturnValue(vi.fn());
  initializeScheduler("web");
  await vi.advanceTimersByTimeAsync(0);

  expect(registeredJobCatalog().map(({ name }) => name)).toContain(
    "outbox-drain",
  );
  expect(registeredJobCatalog().map(({ name }) => name)).toContain(
    "customer-invitation-delivery",
  );
  expect(registeredJobs()).toHaveLength(1);
  expect(registeredJobByName("customer-invitation-delivery")).toBeDefined();
  expect(registeredJobByName("outbox-drain")).toBeUndefined();
  expect(mocks.manualWorker).not.toHaveBeenCalled();
});

it("keeps general jobs and manual execution on jobs without claiming invitation delivery", async () => {
  mocks.manualWorker.mockReturnValue(vi.fn());
  initializeScheduler("jobs");
  await vi.waitFor(() => expect(mocks.manualWorker).toHaveBeenCalledOnce());

  expect(registeredJobCatalog().map(({ name }) => name)).toContain(
    "customer-invitation-delivery",
  );
  expect(registeredJobByName("outbox-drain")).toBeDefined();
  expect(registeredJobByName("customer-invitation-delivery")).toBeUndefined();
  const resolveManual = mocks.manualWorker.mock.calls[0]?.[0] as (
    name: string,
  ) => unknown;
  expect(resolveManual("customer-invitation-delivery")).toBeUndefined();
});
