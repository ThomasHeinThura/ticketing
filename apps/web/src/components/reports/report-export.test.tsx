import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportExportInfo } from "@/fetchers/report";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && "count" in options ? `${key} ${options.count}` : key,
  }),
}));

const exported = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isError: false,
  },
}));
vi.mock("@/hooks/queries/report", () => ({
  useReportExport: () => exported.current,
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/report", () => ({
  downloadReportExport: download,
}));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));

import { ReportExportStatus, useExportAction } from "./report-export";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const info = (overrides: Partial<ReportExportInfo>): ReportExportInfo => ({
  id: "e1",
  kind: "report",
  reportKey: "at_risk_now",
  title: "At-risk now",
  status: "queued",
  rowCount: null,
  byteSize: null,
  truncated: false,
  error: null,
  downloadCount: 0,
  createdAt: "2026-10-24T09:00:00.000Z",
  finishedAt: null,
  expiresAt: null,
  ...overrides,
});

function wrap(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

function show(data: ReportExportInfo | undefined, isError = false) {
  exported.current = { data: data ? { data } : undefined, isError };
  return render(
    wrap(<ReportExportStatus id="e1" onDismiss={() => undefined} />),
  );
}

describe("a queued export (RP-10)", () => {
  it("says it is waiting, with no download and no dismiss while it runs", () => {
    show(info({ status: "running" }));
    expect(
      screen.getByText("reports:export.status.running.title"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the authenticated download once ready, and says when rows were cut", async () => {
    download.mockResolvedValue({
      filename: "x.csv",
      blob: new Blob(["a"]),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    show(info({ status: "ready", rowCount: 210, truncated: true }));
    expect(
      screen.getByText("reports:export.status.ready.description 210"),
    ).toBeTruthy();
    expect(screen.getByText("reports:export.truncated")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "reports:export.download" }),
    );
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith("e1"));
  });

  it("states a failure and an expiry, and lets them be dismissed", () => {
    const { unmount } = show(info({ status: "failed", error: "forbidden" }));
    expect(screen.getByText("reports:export.status.failed.title")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "reports:export.dismiss" }),
    ).toBeTruthy();
    unmount();
    show(info({ status: "expired" }));
    expect(
      screen.getByText("reports:export.status.expired.title"),
    ).toBeTruthy();
  });

  it("says when the export cannot be found", () => {
    show(undefined, true);
    expect(
      screen.getByText("reports:export.status.unavailable.title"),
    ).toBeTruthy();
  });
});

function Probe({
  start,
}: {
  start: () => Promise<
    | { kind: "file"; filename: string; blob: Blob }
    | { kind: "queued"; export: ReportExportInfo }
  >;
}) {
  const action = useExportAction(start);
  return (
    <>
      <Button onClick={action.run}>go</Button>
      {action.panel}
    </>
  );
}

describe("the export action", () => {
  it("downloads a small export at once", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const start = vi.fn().mockResolvedValue({
      kind: "file",
      filename: "a.csv",
      blob: new Blob(["a"]),
    });
    exported.current = { data: undefined, isError: false };
    render(wrap(<Probe start={start} />));
    fireEvent.click(screen.getByText("go"));
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(screen.queryByTestId("report-export-status")).toBeNull();
  });

  it("follows a large export instead of downloading it", async () => {
    const start = vi
      .fn()
      .mockResolvedValue({ kind: "queued", export: info({}) });
    exported.current = { data: { data: info({}) }, isError: false };
    render(wrap(<Probe start={start} />));
    fireEvent.click(screen.getByText("go"));
    await screen.findByTestId("report-export-status");
    expect(toasts.info).toHaveBeenCalledWith("reports:export.queuedToast");
  });

  it("words the per-person limit", async () => {
    const { HttpError } = await import("@/lib/http-error");
    const start = vi
      .fn()
      .mockRejectedValue(new HttpError(429, "too_many_exports"));
    render(wrap(<Probe start={start} />));
    fireEvent.click(screen.getByText("go"));
    await vi.waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("reports:export.tooMany"),
    );
  });
});
