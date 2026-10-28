import { useQuery } from "@tanstack/react-query";
import {
  getWorkItemAuditHistory,
  getWorkItemReconstruction,
} from "@/fetchers/work-item/get-work-item-audit-history";

export function useGetWorkItemAuditHistory(
  key: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["work-items", "audit-history", key],
    queryFn: () => getWorkItemAuditHistory(key as string),
    enabled: !!key && enabled,
  });
}

export function useGetWorkItemReconstruction(
  key: string | undefined,
  at: string | null,
) {
  return useQuery({
    queryKey: ["work-items", "reconstruct", key, at],
    queryFn: () => getWorkItemReconstruction(key as string, at as string),
    enabled: !!key && !!at,
  });
}
