import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportExportInfo } from "@/fetchers/report";
import { HttpError } from "@/lib/http-error";
import { routes } from "@/lib/routes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

const exported = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));
vi.mock("@/hooks/queries/report", () => ({
  useReportExport: () => exported.current,
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/report", async () => {
  const { HttpError: Base } = await import("@/lib/http-error");
  class ReportsDisabledError extends Base {
    constructor() {
      super(409, "feature_disabled");
    }
  }
  return { downloadReportExport: download, ReportsDisabledError };
});
const saved = vi.hoisted(() => vi.fn());
vi.mock("./report-export", () => ({ saveBlob: saved }));

import { ReportExportPage } from "./report-export-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const info = (overrides: Partial<ReportExportInfo>): ReportExportInfo => ({
  id: "e1",
  kind: "report",
  reportKey: "customer_performance",
  title: "Customer performance",
  status: "ready",
  rowCount: 200,
  byteSize: 1000,
  truncated: false,
  error: null,
  downloadCount: 0,
  createdAt: "2026-10-27T09:00:00.000Z",
  finishedAt: "2026-10-27T09:01:00.000Z",
  expiresAt: "2026-10-28T09:01:00.000Z",
  ...overrides,
});

function show(
  state: Partial<typeof exported.current>,
): ReturnType<typeof render> {
  exported.current = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportExportPage exportId="e1" />
    </QueryClientProvider>,
  );
}

const pageState = () =>
  screen.getByTestId("report-export-page-state").getAttribute("data-state");

describe("routes.reportExport (P5-R3-01)", () => {
  it("is the agent page the export-ready email links to", () => {
    expect(routes.reportExport.path).toBe("/agent/reports/exports/$id");
    expect(routes.reportExport.build({ id: "a b" })).toBe(
      "/agent/reports/exports/a%20b",
    );
  });
});

describe("ReportExportPage (P5-R3-01)", () => {
  it("offers the download of a ready export and fetches the file only when asked", async () => {
    download.mockResolvedValue({ filename: "e.csv", blob: new Blob(["a"]) });
    show({ data: { data: info({}) } });
    expect(pageState()).toBe("ready");
    expect(screen.getByText("Customer performance")).toBeTruthy();
    // Opening the page never downloads (and so never audits) on its own.
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /export.download/ }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("shows a queued or running export as waiting, with no download", () => {
    show({ data: { data: info({ status: "running", rowCount: null }) } });
    expect(pageState()).toBe("running");
    expect(screen.queryByRole("button", { name: /export.download/ })).toBe(
      null,
    );
  });

  it("shows an expired or failed export with a way back to the report", () => {
    show({ data: { data: info({ status: "expired" }) } });
    expect(pageState()).toBe("expired");
    expect(screen.getByText("reports:exportPage.openReport")).toBeTruthy();
    cleanup();
    show({
      data: { data: info({ status: "failed", error: "too_many_rows" }) },
    });
    expect(pageState()).toBe("failed");
  });

  it("words a missing, forbidden or switched-off export", async () => {
    show({ isError: true, error: new HttpError(404, "Export not found") });
    expect(pageState()).toBe("notFound");
    cleanup();
    show({ isError: true, error: new HttpError(403, "Forbidden") });
    expect(pageState()).toBe("forbidden");
    cleanup();
    show({ isError: true, error: new HttpError(409, "feature_disabled") });
    // A plain 409 from the status read is not the feature switch: it is an unavailable state.
    expect(pageState()).toBe("unavailable");
    cleanup();
    const { ReportsDisabledError } = await import("@/fetchers/report");
    show({ isError: true, error: new ReportsDisabledError() });
    expect(pageState()).toBe("disabled");
  });

  it("turns a 410 download into the expired state and a 409 or 403 into an alert", async () => {
    download.mockRejectedValueOnce(new HttpError(410, "expired"));
    show({ data: { data: info({}) } });
    fireEvent.click(screen.getByRole("button", { name: /export.download/ }));
    await waitFor(() => expect(pageState()).toBe("expired"));
    expect(exported.current.refetch).toHaveBeenCalled();
    cleanup();

    download.mockRejectedValueOnce(new HttpError(403, "rates_revoked"));
    show({ data: { data: info({}) } });
    fireEvent.click(screen.getByRole("button", { name: /export.download/ }));
    await waitFor(() =>
      expect(screen.getByTestId("report-export-download-error")).toBeTruthy(),
    );
    expect(
      screen.getByText("reports:exportPage.download.revoked.title"),
    ).toBeTruthy();
    cleanup();

    download.mockRejectedValueOnce(new HttpError(409, "not_ready"));
    show({ data: { data: info({}) } });
    fireEvent.click(screen.getByRole("button", { name: /export.download/ }));
    await waitFor(() =>
      expect(
        screen.getByText("reports:exportPage.download.notReady.title"),
      ).toBeTruthy(),
    );
  });
});
