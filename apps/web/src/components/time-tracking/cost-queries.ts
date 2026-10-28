import { useQuery } from "@tanstack/react-query";
import {
  getAvailableHours,
  getCostTypes,
  getProjectCosts,
  TimeTrackingDisabledError,
} from "@/fetchers/time-tracking";
import { timeKeys } from "@/hooks/queries/time-tracking/use-time-tracking";
import { currencyExponent } from "@/lib/money-minor";

/** A feature switch (409) or a refusal (4xx) is a state of the screen, not an error to retry. */
function retryUnlessRefused(count: number, error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (error instanceof TimeTrackingDisabledError) return false;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return count < 2;
}

export function useCostTypes(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...timeKeys.all, "cost-types", workspaceId ?? ""],
    queryFn: () => getCostTypes(workspaceId as string, true),
    enabled: Boolean(workspaceId) && enabled,
    retry: retryUnlessRefused,
  });
}

export function useProjectCosts(
  projectId: string | undefined,
  workItemId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...timeKeys.all, "costs", projectId ?? "", workItemId],
    queryFn: () => getProjectCosts(projectId as string, { workItemId }),
    enabled: Boolean(projectId) && enabled,
    retry: retryUnlessRefused,
  });
}

export function useAvailableHours(
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...timeKeys.all, "available-hours", workspaceId ?? ""],
    queryFn: () => getAvailableHours(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
    retry: retryUnlessRefused,
  });
}

export function isRefused(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return status !== undefined && status >= 400 && status < 500;
}

/** Whole units for a cost entry: 1..1,000,000, or null. */
export function parseUnits(input: string): number | null {
  if (!/^\d{1,7}$/u.test(input.trim())) return null;
  const units = Number(input.trim());
  return units >= 1 && units <= 1_000_000 ? units : null;
}

/**
 * Hours per week typed as `40`, `37.5`, `37,5` or `37:30` into whole minutes (0..10080), by
 * integer arithmetic only, so a float never reaches the API.
 */
export function parseHoursPerWeek(input: string): number | null {
  const text = input.trim();
  const clock = /^(\d{1,3}):([0-5]\d)$/u.exec(text);
  let minutes: number | null = null;
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else {
    const decimal = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u.exec(text);
    if (decimal) {
      const hundredths = Number((decimal[2] ?? "").padEnd(2, "0") || 0);
      minutes = Number(decimal[1]) * 60 + Math.round((hundredths * 60) / 100);
    }
  }
  return minutes !== null && minutes <= 10080 ? minutes : null;
}

/** `12345`, `EUR` -> `123.45` for an input field: integer arithmetic, no grouping, no currency code. */
export function plainMajor(amountMinor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const unit = 10 ** exponent;
  const major = Math.floor(amountMinor / unit);
  if (exponent === 0) return String(major);
  return `${major}.${String(amountMinor % unit).padStart(exponent, "0")}`;
}
