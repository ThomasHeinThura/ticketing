import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCatalogueStatus,
  getChange,
  getChangeCalendar,
  getRelease,
  getService,
  getServiceImpact,
  listFreezeOverrides,
  listFreezes,
  listHolidayPresets,
  listReleases,
  listServices,
} from "@/fetchers/service-management";
import { HttpError } from "@/lib/http-error";

export const serviceManagementKeys = {
  all: ["service-management"] as const,
  status: (workspaceId: string) =>
    ["service-management", "status", workspaceId] as const,
  services: (workspaceId: string, q?: string) =>
    ["service-management", "services", workspaceId, q ?? ""] as const,
  service: (id: string) => ["service-management", "service", id] as const,
  impact: (id: string) => ["service-management", "impact", id] as const,
  change: (key: string) => ["service-management", "change", key] as const,
  calendar: (workspaceId: string, from: string, to: string) =>
    ["service-management", "calendar", workspaceId, from, to] as const,
  freezes: (workspaceId: string, includeCancelled: boolean) =>
    ["service-management", "freezes", workspaceId, includeCancelled] as const,
  overrides: (workspaceId: string) =>
    ["service-management", "overrides", workspaceId] as const,
  releases: (workspaceId: string, serviceId?: string) =>
    ["service-management", "releases", workspaceId, serviceId ?? ""] as const,
  release: (id: string) => ["service-management", "release", id] as const,
  presets: (calendarId: string) =>
    ["service-management", "presets", calendarId] as const,
};

/** Never refused for a disabled feature, so navigation can decide whether to show the screens. */
export function useCatalogueStatus(workspaceId: string) {
  return useQuery({
    queryKey: serviceManagementKeys.status(workspaceId),
    queryFn: () => getCatalogueStatus(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    retry: false,
  });
}

/** True when a request failed because the feature switch is off for the workspace. */
export function isFeatureDisabled(error: unknown) {
  return error instanceof HttpError && error.status === 409;
}

export function useServices(workspaceId: string, q?: string) {
  return useQuery({
    queryKey: serviceManagementKeys.services(workspaceId, q),
    queryFn: () => listServices(workspaceId, q),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

export function useService(id: string) {
  return useQuery({
    queryKey: serviceManagementKeys.service(id),
    queryFn: () => getService(id),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useServiceImpact(id: string) {
  return useQuery({
    queryKey: serviceManagementKeys.impact(id),
    queryFn: () => getServiceImpact(id),
    enabled: Boolean(id),
    retry: false,
  });
}

/** The change section of a work item; `isChange` false (or an error) means the section is not shown. */
export function useChange(key: string) {
  return useQuery({
    queryKey: serviceManagementKeys.change(key),
    queryFn: () => getChange(key),
    enabled: Boolean(key),
    retry: false,
    staleTime: 15_000,
  });
}

export function useChangeCalendar(workspaceId: string, from: Date, to: Date) {
  return useQuery({
    queryKey: serviceManagementKeys.calendar(
      workspaceId,
      from.toISOString(),
      to.toISOString(),
    ),
    queryFn: () => getChangeCalendar(workspaceId, from, to),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

export function useFreezes(workspaceId: string, includeCancelled = false) {
  return useQuery({
    queryKey: serviceManagementKeys.freezes(workspaceId, includeCancelled),
    queryFn: () => listFreezes(workspaceId, includeCancelled),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

export function useFreezeOverrides(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: serviceManagementKeys.overrides(workspaceId),
    queryFn: () => listFreezeOverrides(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    retry: false,
  });
}

export function useReleases(workspaceId: string, serviceId?: string) {
  return useQuery({
    queryKey: serviceManagementKeys.releases(workspaceId, serviceId),
    queryFn: () => listReleases(workspaceId, serviceId),
    enabled: Boolean(workspaceId),
    retry: false,
  });
}

export function useRelease(id: string) {
  return useQuery({
    queryKey: serviceManagementKeys.release(id),
    queryFn: () => getRelease(id),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useHolidayPresets(calendarId: string, enabled = true) {
  return useQuery({
    queryKey: serviceManagementKeys.presets(calendarId),
    queryFn: () => listHolidayPresets(calendarId),
    enabled: Boolean(calendarId) && enabled,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** Refetch everything the service-management screens show after a write. */
export function useInvalidateServiceManagement() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: serviceManagementKeys.all });
}
