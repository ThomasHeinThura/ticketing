import { useQuery } from "@tanstack/react-query";
import { getTeam, getTeams } from "@/fetchers/team";

export const teamsKey = (workspaceId: string) =>
  ["teams", workspaceId] as const;
export const teamKey = (id: string, includeInactive: boolean) =>
  ["team", id, includeInactive] as const;

export function useTeams(workspaceId: string) {
  return useQuery({
    queryKey: teamsKey(workspaceId),
    queryFn: () => getTeams(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export function useTeam(id: string, includeInactive = false) {
  return useQuery({
    queryKey: teamKey(id, includeInactive),
    queryFn: () => getTeam(id, includeInactive),
    enabled: Boolean(id),
  });
}
