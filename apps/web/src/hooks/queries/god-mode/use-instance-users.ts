import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
  getInstanceUser,
  getInstanceUsers,
  grantInstanceAdmin,
  type InstanceUserFilters,
  requestInstanceUserDeactivation,
  resetInstanceUserMfa,
  signOutInstanceUser,
  startInstanceUserImpersonation,
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

  const pending = useRef<unknown>(null);
  async function submit<T extends { id: string }, R>(
    input: T,
    run: (safe: { id: string }) => Promise<R>,
  ) {
    if (pending.current) throw new Error("User action already pending");
    pending.current = input;
    try {
      return await run({ id: input.id });
    } finally {
      pending.current = null;
    }
  }
  function request<T>(): T {
    if (!pending.current) throw new Error("No user action pending");
    return pending.current as T;
  }
  const suspend = useMutation({
    mutationFn: (_safe: { id: string }) =>
      suspendInstanceUser(request<Parameters<typeof suspendInstanceUser>[0]>()),
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
    mutationFn: (_safe: { id: string }) =>
      grantInstanceAdmin(request<Parameters<typeof grantInstanceAdmin>[0]>()),
    onSuccess: (_result, input) => refresh(input.id),
  });
  const resetMfa = useMutation({
    mutationFn: (_safe: { id: string }) =>
      resetInstanceUserMfa(
        request<Parameters<typeof resetInstanceUserMfa>[0]>(),
      ),
    onSuccess: (_result, input) => refresh(input.id),
  });

  // The session cookie changes on success, so the caller reloads the app instead of refreshing
  // cached queries.
  const impersonate = useMutation({
    mutationFn: (_safe: { id: string }) =>
      startInstanceUserImpersonation(
        request<Parameters<typeof startInstanceUserImpersonation>[0]>(),
      ),
  });

  return {
    suspend: {
      ...suspend,
      mutateAsync: (input: Parameters<typeof suspendInstanceUser>[0]) =>
        submit(input, suspend.mutateAsync),
    },
    unsuspend,
    signOut,
    deactivate,
    grantAdmin: {
      ...grantAdmin,
      mutateAsync: (input: Parameters<typeof grantInstanceAdmin>[0]) =>
        submit(input, grantAdmin.mutateAsync),
    },
    resetMfa: {
      ...resetMfa,
      mutateAsync: (input: Parameters<typeof resetInstanceUserMfa>[0]) =>
        submit(input, resetMfa.mutateAsync),
    },
    impersonate: {
      ...impersonate,
      mutateAsync: (
        input: Parameters<typeof startInstanceUserImpersonation>[0],
      ) => submit(input, impersonate.mutateAsync),
    },
  };
}
