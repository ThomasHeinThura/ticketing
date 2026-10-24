import { useQuery } from "@tanstack/react-query";
import {
  type CustomQueryInput,
  getDashboard,
  getDashboards,
  getReport,
  getReportCatalogue,
  getReportItems,
  getWidgetData,
  previewCustomReport,
  ReportsDisabledError,
} from "@/fetchers/report";
import type { ReportSearch } from "@/lib/report-search";

export const reportKeys = {
  all: (workspaceId: string) => ["reports", workspaceId] as const,
  catalogue: (workspaceId: string) =>
    ["reports", workspaceId, "catalogue"] as const,
  report: (workspaceId: string, key: string, search: ReportSearch) =>
    ["reports", workspaceId, "report", key, search] as const,
  items: (
    workspaceId: string,
    key: string,
    search: ReportSearch,
    handle: string | null,
  ) => ["reports", workspaceId, "items", key, search, handle] as const,
  preview: (workspaceId: string, body: unknown) =>
    ["reports", workspaceId, "preview", body] as const,
  dashboards: (workspaceId: string) =>
    ["reports", workspaceId, "dashboards"] as const,
  dashboard: (workspaceId: string, id: string) =>
    ["reports", workspaceId, "dashboard", id] as const,
  widget: (workspaceId: string, dashboardId: string, widgetId: string) =>
    ["reports", workspaceId, "widget", dashboardId, widgetId] as const,
};

/** A switch the API answers 409 for, or a refusal, is a state of the screen, not an error to retry. */
function noRetry(count: number, error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (error instanceof ReportsDisabledError) return false;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return count < 2;
}

export function useReportCatalogue(workspaceId: string) {
  return useQuery({
    queryKey: reportKeys.catalogue(workspaceId),
    queryFn: () => getReportCatalogue(workspaceId),
    enabled: Boolean(workspaceId),
    retry: noRetry,
  });
}

export function useReport(
  workspaceId: string,
  key: string,
  search: ReportSearch,
  enabled = true,
) {
  return useQuery({
    queryKey: reportKeys.report(workspaceId, key, search),
    queryFn: () => getReport(workspaceId, key, search),
    enabled: Boolean(workspaceId && key) && enabled,
    retry: noRetry,
    staleTime: 30_000,
  });
}

export function useReportItems(
  workspaceId: string,
  key: string,
  search: ReportSearch,
  handle: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: reportKeys.items(workspaceId, key, search, handle),
    queryFn: () => getReportItems(workspaceId, key, search, handle),
    enabled: Boolean(workspaceId && key) && enabled,
    retry: noRetry,
  });
}

export function useCustomPreview(
  workspaceId: string,
  body: {
    name?: string;
    query: CustomQueryInput;
    chartType: "bar" | "line" | "table" | "number";
  } | null,
) {
  return useQuery({
    queryKey: reportKeys.preview(workspaceId, body),
    queryFn: () =>
      previewCustomReport({
        workspaceId,
        ...(body as NonNullable<typeof body>),
      }),
    enabled: Boolean(workspaceId && body),
    retry: noRetry,
  });
}

export function useDashboards(workspaceId: string) {
  return useQuery({
    queryKey: reportKeys.dashboards(workspaceId),
    queryFn: () => getDashboards(workspaceId),
    enabled: Boolean(workspaceId),
    retry: noRetry,
  });
}

export function useDashboard(workspaceId: string, id: string) {
  return useQuery({
    queryKey: reportKeys.dashboard(workspaceId, id),
    queryFn: () => getDashboard(id, workspaceId),
    enabled: Boolean(workspaceId && id),
    retry: noRetry,
  });
}

export function useWidgetData(
  workspaceId: string,
  dashboardId: string,
  widgetId: string,
  version: number,
) {
  return useQuery({
    // The dashboard version is in the key: a saved layout refetches, a plain re-render does not.
    queryKey: [
      ...reportKeys.widget(workspaceId, dashboardId, widgetId),
      version,
    ],
    queryFn: () => getWidgetData(dashboardId, widgetId, workspaceId),
    enabled: Boolean(workspaceId && dashboardId && widgetId),
    retry: noRetry,
    staleTime: 30_000,
  });
}
