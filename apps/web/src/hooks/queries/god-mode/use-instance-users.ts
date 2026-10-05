import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInstanceUser,
  getInstanceUsers,
  grantInstanceAdmin,
  type InstanceUserFilters,
  requestInstanceUserDeactivation,
  resetInstanceUserMfa,
  signOutInstanceUser,
  suspendInstanceUser,
  unsuspendInstanceUser,
} from "@/fetchers/god-mode/instance-users";

export const instanceUsersKey = ["god-mode", "instance-users"] as const;

export function useInstanceUsers(filters: InstanceUserFilters) {
  return useQuery({
    queryKey: [...instanceUsersKey, filters],
    queryFn: () => getInstanceUsers(filters),
    staleTime: 15_000,
  });
}

export function useInstanceUser(userId: string | undefined) {
  return useQuery({
    queryKey: [...instanceUsersKey, "detail", userId],
    queryFn: () => getInstanceUser(userId as string),
    enabled: Boolean(userId),
  });
}

export function useInstanceUserActions() {
  const queryClient = useQueryClient();
  const refresh = async (userId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: instanceUsersKey }),
      queryClient.invalidateQueries({
        queryKey: [...instanceUsersKey, "detail", userId],
      }),
    ]);
  };

  const suspend = useMutation({
    mutationFn: suspendInstanceUser,
    onSuccess: (_result, input) => refresh(input.id),
  });
  const unsuspend = useMutation({
    mutationFn: unsuspendInstanceUser,
    onSuccess: (_result, id) => refresh(id),
  });
  const signOut = useMutation({
    mutationFn: signOutInstanceUser,
    onSuccess: (_result, id) => refresh(id),
  });
  const deactivate = useMutation({
    mutationFn: requestInstanceUserDeactivation,
    onSuccess: (_result, id) => refresh(id),
  });
  const grantAdmin = useMutation({
    mutationFn: grantInstanceAdmin,
    onSuccess: (_result, input) => refresh(input.id),
  });
  const resetMfa = useMutation({
    mutationFn: resetInstanceUserMfa,
    onSuccess: (_result, input) => refresh(input.id),
  });

  return { suspend, unsuspend, signOut, deactivate, grantAdmin, resetMfa };
}
