import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceJobs } from "@/fetchers/god-mode/instance-jobs";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "checkedAt") return `Updated ${String(options?.when ?? "")}`;
      if (key === "defaultSchedule")
        return `Default: ${String(options?.pattern ?? "")}`;
      if (key === "timezone")
        return `Timezone: ${String(options?.timezone ?? "")}`;
      return key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));
vi.mock("@/fetchers/god-mode/instance-jobs", () => ({
  listInstanceJobs: () => mocks.list(),
  updateInstanceJob: (...args: unknown[]) => mocks.update(...args),
  queueInstanceJobRun: (...args: unknown[]) => mocks.queue(...args),
}));

import { InstanceJobsPanel } from "./instance-jobs-panel";

const sample: InstanceJobs = {
  checkedAt: "2026-10-25T12:00:00.000Z",
  jobs: [
    {
      name: "outbox-drain",
      pattern: "*/30 * * * * *",
      defaultPattern: "*/30 * * * * *",
      timezone: null,
      enabled: true,
      version: 0,
      nextRunAt: "2026-10-25T12:00:30.000Z",
      manualRunAllowed: true,
      lastRun: {
        id: "run-1",
        trigger: "scheduled",
        state: "succeeded",
        requestedAt: "2026-10-25T11:59:30.000Z",
        startedAt: "2026-10-25T11:59:30.000Z",
        finishedAt: "2026-10-25T11:59:31.000Z",
        durationMs: 1000,
        errorCode: null,
      },
      queuedRun: null,
    },
    {
      name: "secrets-rekey",
      pattern: null,
      defaultPattern: null,
      timezone: null,
      enabled: true,
      version: 0,
      nextRunAt: null,
      manualRunAllowed: false,
      lastRun: null,
      queuedRun: null,
    },
  ],
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(sample);
  mocks.update.mockReset().mockResolvedValue({ job: sample.jobs[0] });
  mocks.queue.mockReset().mockResolvedValue({
    run: { id: "queued-run", state: "queued" },
  });
});
afterEach(cleanup);

function renderPanel() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstanceJobsPanel />
    </QueryClientProvider>,
  );
}

describe("InstanceJobsPanel", () => {
  it("shows persisted schedule and recent run metadata, while keeping elevated jobs out of generic run controls", async () => {
    renderPanel();
    expect(await screen.findByText("outbox-drain")).toBeInTheDocument();
    expect(screen.getAllByText("nextScheduledRun")).toHaveLength(2);
    expect(screen.getByText("Default: */30 * * * * *")).toBeInTheDocument();
    expect(screen.getByText("states.succeeded")).toBeInTheDocument();
    expect(screen.getByText("1000 ms")).toBeInTheDocument();
    expect(screen.getByText("secrets-rekey")).toBeInTheDocument();
    expect(screen.getByText("elevatedOperationOnly")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "runNow" })).toHaveLength(1);
  });

  it("queues only the selected registered manual job", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "runNow" }));
    await waitFor(() => expect(mocks.queue).toHaveBeenCalled());
    expect(mocks.queue.mock.calls[0]?.[0]).toBe("outbox-drain");
    expect(
      mocks.queue.mock.calls.some(([name]) => name === "secrets-rekey"),
    ).toBe(false);
  });

  it("shows queued work separately from last execution and disables duplicate queueing", async () => {
    mocks.list.mockResolvedValue({
      ...sample,
      jobs: sample.jobs.map((job) =>
        job.name === "outbox-drain"
          ? {
              ...job,
              queuedRun: {
                id: "queued-run-id",
                trigger: "manual" as const,
                state: "queued" as const,
                requestedAt: "2026-10-25T12:01:00.000Z",
                startedAt: null,
                finishedAt: null,
                durationMs: null,
                errorCode: null,
              },
            }
          : job,
      ),
    });
    renderPanel();
    expect(await screen.findByText("outbox-drain")).toBeInTheDocument();
    expect(screen.getByText("queuedRun · states.queued")).toBeInTheDocument();
    expect(screen.getByText("states.succeeded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "runNow" })).toBeDisabled();
  });
});
