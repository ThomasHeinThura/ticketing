import { useQuery } from "@tanstack/react-query";
import {
  getRole,
  getRoleHistory,
  getRoleHolders,
} from "@/fetchers/workspace-roles";

export const roleDetailKey = (workspaceId: string, roleId: string) =>
  ["workspace-role", workspaceId, roleId] as const;
export const roleHoldersKey = (workspaceId: string, roleId: string) =>
  ["workspace-role-holders", workspaceId, roleId] as const;
export const roleHistoryKey = (workspaceId: string, roleId: string) =>
  ["workspace-role-history", workspaceId, roleId] as const;

export function useRole(workspaceId: string, roleId: string) {
  return useQuery({
    queryKey: roleDetailKey(workspaceId, roleId),
    queryFn: () => getRole(workspaceId, roleId),
    enabled: Boolean(workspaceId && roleId),
  });
}

export function useRoleHolders(workspaceId: string, roleId: string) {
  return useQuery({
    queryKey: roleHoldersKey(workspaceId, roleId),
    queryFn: () => getRoleHolders(workspaceId, roleId),
    enabled: Boolean(workspaceId && roleId),
  });
}

export function useRoleHistory(
  workspaceId: string,
  roleId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: roleHistoryKey(workspaceId, roleId),
    queryFn: () => getRoleHistory(workspaceId, roleId),
    enabled: Boolean(workspaceId && roleId) && enabled,
  });
}
