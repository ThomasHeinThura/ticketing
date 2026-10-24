import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import {
  getHourlyRates,
  getProjectBudget,
  getTimeActivities,
  getTimeEntries,
  getTimer,
  getTimeSettings,
  type TimeEntryFilter,
  TimeTrackingDisabledError,
} from "@/fetchers/time-tracking";

export const timeKeys = {
  all: ["time-tracking"] as const,
  entries: (filter: TimeEntryFilter) =>
    ["time-tracking", "entries", filter] as const,
  timer: (workspaceId: string) =>
    ["time-tracking", "timer", workspaceId] as const,
  activities: (workspaceId: string, includeArchived: boolean) =>
    ["time-tracking", "activities", workspaceId, includeArchived] as const,
  rates: (workspaceId: string) =>
    ["time-tracking", "rates", workspaceId] as const,
  budget: (projectId: string) =>
    ["time-tracking", "budget", projectId] as const,
  features: (projectId: string) =>
    ["time-tracking", "features", projectId] as const,
};

/**
 * A feature switch the API answers 409 for, or a refusal (403/404), is a state of the screen, not
 * an error to retry.
 */
function noRetryWhenDisabled(count: number, error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (error instanceof TimeTrackingDisabledError) return false;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return count < 2;
}

export function useTimeEntries(filter: TimeEntryFilter | null) {
  return useQuery({
    queryKey: timeKeys.entries(filter ?? { workspaceId: "" }),
    queryFn: () => getTimeEntries(filter as TimeEntryFilter),
    enabled: Boolean(filter?.workspaceId),
    retry: noRetryWhenDisabled,
  });
}

export function useTimer(workspaceId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.timer(workspaceId ?? ""),
    queryFn: () => getTimer(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry: noRetryWhenDisabled,
  });
}

export function useTimeActivities(
  workspaceId: string | undefined,
  includeArchived = false,
) {
  return useQuery({
    queryKey: timeKeys.activities(workspaceId ?? "", includeArchived),
    queryFn: () => getTimeActivities(workspaceId as string, includeArchived),
    enabled: Boolean(workspaceId),
    retry: noRetryWhenDisabled,
  });
}

export function useTimeSettings(
  workspaceId: string | undefined,
  projectId?: string,
) {
  return useQuery({
    queryKey: ["time-tracking", "settings", workspaceId ?? "", projectId ?? ""],
    queryFn: () => getTimeSettings(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: noRetryWhenDisabled,
  });
}

export function useHourlyRates(workspaceId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.rates(workspaceId ?? ""),
    queryFn: () => getHourlyRates(workspaceId as string),
    enabled: Boolean(workspaceId),
    retry: noRetryWhenDisabled,
  });
}

export function useProjectBudget(projectId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.budget(projectId ?? ""),
    queryFn: () => getProjectBudget(projectId as string),
    enabled: Boolean(projectId),
    retry: noRetryWhenDisabled,
  });
}

/**
 * The project's resolved `feature.time_tracking` / `feature.cost_tracking` switches. Both are off
 * by default, so a pending or failed read hides the Time section rather than offering a control
 * the API would answer 409.
 */
export function useTimeTrackingFeatures(projectId: string | undefined) {
  const query = useQuery({
    queryKey: timeKeys.features(projectId ?? ""),
    queryFn: async () => {
      const response = await apiFetch(
        getApiUrl(
          `/features/resolved?project=${encodeURIComponent(projectId as string)}`,
        ),
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load the feature switches");
      return (
        (await response.json()) as {
          features: Array<{ key: string; enabled: boolean }>;
        }
      ).features;
    },
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const on = (key: string) =>
    query.data?.some((feature) => feature.key === key && feature.enabled) ??
    false;
  return {
    time: on("feature.time_tracking"),
    cost: on("feature.time_tracking") && on("feature.cost_tracking"),
    isLoading: query.isLoading,
  };
}
