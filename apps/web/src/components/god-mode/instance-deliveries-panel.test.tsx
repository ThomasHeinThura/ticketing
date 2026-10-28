import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceDeliveries } from "@/fetchers/god-mode/instance-deliveries";

const mocks = vi.hoisted(() => ({ list: vi.fn(), requeue: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "checkedAt") return `Checked ${String(options?.when ?? "")}`;
      if (key === "childCount")
        return `${String(options?.count ?? "")} children`;
      return key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => value,
}));
vi.mock("@/fetchers/god-mode/instance-deliveries", () => ({
  getInstanceDeliveries: () => mocks.list(),
  requeueInstanceDelivery: (...args: unknown[]) => mocks.requeue(...args),
}));

import { InstanceDeliveriesPanel } from "./instance-deliveries-panel";

const sample: InstanceDeliveries = {
  checkedAt: "2026-10-25T12:00:00.000Z",
  counts: {
    events: { pending: 1, dead: 1 },
    notifications: { pending: 0, delivered: 2, suppressed: 0, dead: 1 },
    digests: {
      collecting: 1,
      pending: 0,
      delivered: 0,
      suppressed: 0,
      dead: 0,
    },
    webhooks: {
      pending: 0,
      delivered: 0,
      dead: 1,
      skippedOutOfReach: 0,
      cancelled: 0,
    },
  },
  items: [
    {
      id: "webhook-1",
      kind: "webhook",
      state: "dead",
      createdAt: "2026-10-25T11:00:00.000Z",
      eventKind: "work_item.updated",
      attempts: 6,
      statusCode: 500,
      durationMs: 212,
      errorPresent: true,
      requeueAllowed: false,
    },
    {
      id: "event-dead-1",
      kind: "event",
      state: "dead",
      createdAt: "2026-10-25T10:30:00.000Z",
      eventKind: "work_item.updated",
      attempts: 6,
      errorPresent: true,
      requeueAllowed: true,
    },
    {
      id: "digest-1",
      kind: "digest",
      state: "collecting",
      createdAt: "2026-10-25T10:00:00.000Z",
      channel: "notify.email",
      cadence: "daily",
      children: 3,
      requeueAllowed: false,
    },
  ],
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(sample);
  mocks.requeue.mockReset().mockResolvedValue({
    id: "event-dead-1",
    kind: "event",
    state: "pending",
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
      <InstanceDeliveriesPanel />
    </QueryClientProvider>,
  );
}

describe("InstanceDeliveriesPanel", () => {
  it("shows separate queue states and metadata for webhook attempts and digests", async () => {
    renderPanel();
    expect(await screen.findAllByText("work_item.updated")).toHaveLength(2);
    expect(screen.getByText("500 · 212 ms")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("row")
        .find((row) =>
          row.textContent?.includes("cadences.daily · 3 children"),
        ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Checked 2026-10-25T12:00:00.000Z"),
    ).toBeInTheDocument();
  });

  it("does not show provider error content when delivery data fails to load", async () => {
    mocks.list.mockRejectedValue(
      new Error("private endpoint and response body must stay private"),
    );
    renderPanel();
    expect(await screen.findByText("loadErrorTitle")).toBeInTheDocument();
    expect(
      screen.queryByText(/private endpoint and response body/),
    ).not.toBeInTheDocument();
  });

  it("requeues only server-authorized rows and refreshes the persisted list", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "requeue" }));

    await waitFor(() =>
      expect(mocks.requeue.mock.calls[0]?.[0]).toBe("event-dead-1"),
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("button", { name: "requeue" })).toHaveLength(1);
  });

  it("shows generic text when the requeue request fails", async () => {
    mocks.requeue.mockRejectedValue(
      new Error("private provider response and endpoint details"),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "requeue" }));

    expect(await screen.findByText("requeueErrorTitle")).toBeInTheDocument();
    expect(screen.getByText("requeueErrorDescription")).toBeInTheDocument();
    expect(
      screen.queryByText(/private provider response and endpoint details/),
    ).not.toBeInTheDocument();
  });
});
