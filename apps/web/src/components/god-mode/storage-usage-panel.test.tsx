import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), probe: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => `formatted:${value}`,
}));
vi.mock("@/fetchers/god-mode/storage-usage", () => ({
  getStorageUsage: () => mocks.get(),
  runStorageProbe: () => mocks.probe(),
}));

import { StorageUsagePanel } from "./storage-usage-panel";

const sample = {
  checkedAt: "2026-10-25T12:00:00.000Z",
  backend: {
    source: "bootstrap" as const,
    driver: "filesystem" as const,
    configuration: "configured" as const,
    connectivity: "not_checked" as const,
    probeAvailable: true,
  },
  usageBasis: "attachment_metadata" as const,
  physicalUsageAvailable: false as const,
  limits: {
    maxAttachmentBytes: 10485760,
    maxAttachmentsPerItem: 10,
    allowedExtensions: [".png", ".pdf"],
  },
  attachments: {
    ready: { count: 3, bytes: "2048" },
    pending: { count: 1, bytes: "128" },
    deleted: { count: 2, bytes: "4096" },
  },
};

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(sample);
  mocks.probe.mockReset().mockResolvedValue({
    status: "verified",
    cleanup: "not_attempted",
    diagnosticObjectMayRemain: true,
    durationMs: 42,
  });
});
afterEach(cleanup);

function renderPanel() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StorageUsagePanel />
    </QueryClientProvider>,
  );
}

describe("StorageUsagePanel", () => {
  it("labels bootstrap readiness and logical metadata rather than physical usage", async () => {
    renderPanel();
    expect(await screen.findByText("backendTitle")).toBeInTheDocument();
    expect(screen.getByText("drivers.filesystem")).toBeInTheDocument();
    expect(screen.getByText("connectivityDescription")).toBeInTheDocument();
    expect(screen.getByText("probeRetentionNotice")).toBeInTheDocument();
    expect(screen.getByText("physicalUsageUnavailable")).toBeInTheDocument();
    expect(screen.getByText("states.ready")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("shows only the bounded probe outcome after an explicit request", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "runProbe" }));
    expect(
      await screen.findByText("probeStatuses.verified"),
    ).toBeInTheDocument();
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/cleanup.not_attempted/)).toHaveTextContent(
      "probeObjectMayRemain",
    );
    expect(
      screen.getByText("probeStatuses.verified").closest('[role="alert"]'),
    ).toHaveClass("border-warning/32");
  });

  it("reports legacy confirmed cleanup as successful", async () => {
    mocks.probe.mockResolvedValue({
      status: "verified",
      cleanup: "confirmed",
      durationMs: 42,
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "runProbe" }));
    expect(
      (await screen.findByText("probeStatuses.verified")).closest(
        '[role="alert"]',
      ),
    ).toHaveClass("border-success/32");
    expect(screen.getByText(/cleanup.confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/probeObjectMayRemain/)).not.toBeInTheDocument();
  });

  it.each(["write_failed", "read_failed", "content_mismatch", "timed_out"])(
    "preserves the %s result",
    async (status) => {
      mocks.probe.mockResolvedValue({
        status,
        cleanup: "not_attempted",
        diagnosticObjectMayRemain: true,
        durationMs: 42,
      });
      renderPanel();
      fireEvent.click(await screen.findByRole("button", { name: "runProbe" }));
      expect(
        await screen.findByText(`probeStatuses.${status}`),
      ).toBeInTheDocument();
    },
  );

  it("disables the probe while pending and shows request failures", async () => {
    let rejectProbe!: (reason: Error) => void;
    mocks.probe.mockReturnValue(
      new Promise((_, reject) => {
        rejectProbe = reject;
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "runProbe" }));
    expect(
      await screen.findByRole("button", { name: "probing" }),
    ).toBeDisabled();
    rejectProbe(new Error("failed"));
    expect(await screen.findByText("probeRequestFailed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "runProbe" })).toBeEnabled();
  });

  it("shows the permission denial without exposing the probe", async () => {
    mocks.get.mockRejectedValue(new HttpError(403, "Forbidden"));
    renderPanel();
    expect(await screen.findByText("forbiddenTitle")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "runProbe" }),
    ).not.toBeInTheDocument();
  });
});
