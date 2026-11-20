import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import {
  configureIdentityConnection,
  createIdentityConnection,
  createOidcGroupMapping,
  type IdentityConnection,
  patchScimAdmin,
  revokeScimBearer,
  rotateScimBearer,
  type ScimAdminSettings,
  updateOidcGroupMapping,
} from "@/fetchers/god-mode/identity-connections";
import {
  identityConnectionsKey,
  scimAdminKey,
} from "@/hooks/queries/god-mode/use-identity-connections";
import { auditEntity } from "@/query-client/audit-invalidation";

const instance = { kind: "instance" } as const;
const byId = {
  audits: {
    targets: ({ id }: { id: string }) =>
      auditEntity("identity_connection", id, instance),
  },
};
const byConnection = {
  audits: {
    targets: ({ connectionId }: { connectionId: string }) =>
      auditEntity("identity_connection", connectionId, instance),
  },
};

/**
 * The parent `config_version` is shared by the connection editor, the SCIM settings and the SCIM
 * token routes, so every successful write refreshes the other read. The write returns the new
 * state of its own read, which is cached directly.
 */
export function useIdentityConnectionMutations(connectionId: string) {
  const queryClient = useQueryClient();
  const pending = useRef<unknown>(null);
  async function submit<T extends object, R>(
    input: T,
    run: (safe: { id: string; connectionId: string }) => Promise<R>,
  ) {
    if (pending.current) throw new Error("Identity change already pending");
    pending.current = input;
    try {
      const safe = input as { id?: string; connectionId?: string };
      return await run({
        id: safe.id ?? "",
        connectionId: safe.connectionId ?? "",
      });
    } finally {
      pending.current = null;
    }
  }
  function request<T>(): T {
    if (!pending.current) throw new Error("No identity change pending");
    return pending.current as T;
  }
  const refreshConnections = () =>
    queryClient.invalidateQueries({ queryKey: identityConnectionsKey });
  const cacheScim = (settings: ScimAdminSettings) =>
    queryClient.setQueryData(scimAdminKey(connectionId), settings);
  const refreshScim = () =>
    queryClient.invalidateQueries({ queryKey: scimAdminKey(connectionId) });

  const create = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      createIdentityConnection(
        request<Parameters<typeof createIdentityConnection>[0]>(),
      ),
    meta: {
      audits: {
        targets: (_: unknown, created: IdentityConnection) =>
          auditEntity("identity_connection", created.id, instance),
      },
    },
    gcTime: 0,
    onSuccess: refreshConnections,
  });
  const configure = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      configureIdentityConnection(
        request<Parameters<typeof configureIdentityConnection>[0]>(),
      ),
    meta: byId,
    gcTime: 0,
    onSuccess: (connection: IdentityConnection) => {
      queryClient.setQueryData<IdentityConnection[]>(
        identityConnectionsKey,
        (current) =>
          current?.map((item) =>
            item.id === connection.id ? connection : item,
          ),
      );
      // The organisation Identity tab reads the same connection under its own key.
      queryClient.setQueriesData<IdentityConnection | null>(
        { queryKey: [...identityConnectionsKey, "organisation"] },
        (current) =>
          current && current.id === connection.id ? connection : current,
      );
      return refreshConnections();
    },
  });
  const updateScim = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      patchScimAdmin(request<Parameters<typeof patchScimAdmin>[0]>()),
    meta: byId,
    gcTime: 0,
    onSuccess: async (settings: ScimAdminSettings) => {
      cacheScim(settings);
      await refreshConnections();
    },
  });
  const rotateToken = useMutation({
    // The bearer is handed to the caller once and never kept in the mutation cache.
    mutationFn: async (_safe: { id: string; connectionId: string }) => {
      const input = request<
        Parameters<typeof rotateScimBearer>[0] & {
          onBearer: (bearer: string) => void;
        }
      >();
      const { onBearer, ...rotationRequest } = input;
      const result = await rotateScimBearer(rotationRequest);
      onBearer(result.token);
      return {
        configVersion: result.configVersion,
        tokenRotatedAt: result.tokenRotatedAt,
      };
    },
    meta: byId,
    gcTime: 0,
    onSuccess: async () => {
      await Promise.all([refreshConnections(), refreshScim()]);
    },
  });
  const revokeToken = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      revokeScimBearer(request<Parameters<typeof revokeScimBearer>[0]>()),
    meta: byId,
    gcTime: 0,
    onSuccess: async () => {
      await Promise.all([refreshConnections(), refreshScim()]);
    },
  });
  const createOidcMapping = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      createOidcGroupMapping(
        request<Parameters<typeof createOidcGroupMapping>[0]>(),
      ),
    meta: byConnection,
    gcTime: 0,
    onSuccess: refreshConnections,
  });
  const updateOidcMapping = useMutation({
    mutationFn: (_safe: { id: string; connectionId: string }) =>
      updateOidcGroupMapping(
        request<Parameters<typeof updateOidcGroupMapping>[0]>(),
      ),
    meta: byConnection,
    gcTime: 0,
    onSuccess: refreshConnections,
  });
  return {
    create: {
      ...create,
      mutateAsync: (input: Parameters<typeof createIdentityConnection>[0]) =>
        submit(input, create.mutateAsync),
    },
    configure: {
      ...configure,
      mutateAsync: (input: Parameters<typeof configureIdentityConnection>[0]) =>
        submit(input, configure.mutateAsync),
    },
    updateScim: {
      ...updateScim,
      mutateAsync: (input: Parameters<typeof patchScimAdmin>[0]) =>
        submit(input, updateScim.mutateAsync),
    },
    rotateToken: {
      ...rotateToken,
      mutateAsync: (
        input: Parameters<typeof rotateScimBearer>[0] & {
          onBearer: (bearer: string) => void;
        },
      ) => submit(input, rotateToken.mutateAsync),
    },
    revokeToken: {
      ...revokeToken,
      mutateAsync: (input: Parameters<typeof revokeScimBearer>[0]) =>
        submit(input, revokeToken.mutateAsync),
    },
    createOidcMapping: {
      ...createOidcMapping,
      mutateAsync: (input: Parameters<typeof createOidcGroupMapping>[0]) =>
        submit(input, createOidcMapping.mutateAsync),
    },
    updateOidcMapping: {
      ...updateOidcMapping,
      mutateAsync: (input: Parameters<typeof updateOidcGroupMapping>[0]) =>
        submit(input, updateOidcMapping.mutateAsync),
    },
  };
}
