import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => `formatted:${value}`,
}));
vi.mock("@/fetchers/god-mode/mcp-usage", () => ({
  getMcpUsage: () => mocks.get(),
}));

import { McpUsagePanel } from "./mcp-usage-panel";

function renderPanel() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <McpUsagePanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({
    periodStart: "2026-09-25T00:00:00.000Z",
    periodEnd: "2026-10-25T00:00:00.000Z",
    hasMore: false,
    keys: [
      {
        id: "key-opaque-id",
        name: "Build assistant",
        prefix: "tdk_abc123",
        createdAt: "2026-10-01T00:00:00.000Z",
        enabled: true,
        recordedRequestCount: 4,
        lastRecordedAt: "2026-10-24T12:00:00.000Z",
        autoDisabledAt: null,
        clientReportedTools: [],
      },
    ],
  });
});
afterEach(cleanup);

describe("McpUsagePanel", () => {
  it("separates server-recorded request attempts from client reports", async () => {
    renderPanel();

    expect(
      await screen.findByRole("button", { name: "Build assistant" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByText("metricsLimitTitle")).toBeInTheDocument();
    expect(screen.getByText("metricsLimitDescription")).toBeInTheDocument();
    expect(
      screen.getByText("formatted:2026-10-24T12:00:00.000Z"),
    ).toBeInTheDocument();
  });

  it("shows client-reported errors and durations only inside their labeled section", async () => {
    const data = await mocks.get();
    data.keys[0].clientReportedTools = [
      {
        toolName: "get_work_item",
        callCount: 10,
        errorCount: 2,
        errorRate: 0.2,
        meanDurationMs: 32.5,
        maxDurationMs: 71,
        lastReportedAt: "2026-10-25T10:00:00.000Z",
      },
    ];
    mocks.get.mockResolvedValue(data);
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Build assistant" }),
    );
    expect(await screen.findByText("get_work_item")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("32.5")).toBeInTheDocument();
    expect(screen.getByText("toolColumns.errors")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("does not present absent reports as zero errors", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Build assistant" }),
    );
    expect(await screen.findByText("toolsEmpty")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows a truthful empty state when there are no MCP keys", async () => {
    mocks.get.mockResolvedValueOnce({
      periodStart: "2026-09-25T00:00:00.000Z",
      periodEnd: "2026-10-25T00:00:00.000Z",
      hasMore: false,
      keys: [],
    });
    renderPanel();
    expect(await screen.findByText("empty")).toBeInTheDocument();
  });
});
