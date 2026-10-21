import { useQuery } from "@tanstack/react-query";
import { type AuditFilterQuery, getInstanceAudit } from "@/fetchers/audit";

export function useInstanceAudit(enabled = true, query?: AuditFilterQuery) {
  return useQuery({
    queryKey: ["instance", "audit", query],
    queryFn: () => getInstanceAudit(query),
    enabled,
  });
}
