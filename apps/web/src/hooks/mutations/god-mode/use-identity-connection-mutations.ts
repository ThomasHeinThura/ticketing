import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  configureIdentityConnection,
  createIdentityConnection,
  type IdentityConnection,
  patchScimAdmin,
  revokeScimBearer,
  rotateScimBearer,
  type ScimAdminSettings,
} from "@/fetchers/god-mode/identity-connections";
import {
  identityConnectionsKey,
  scimAdminKey,
} from "@/hooks/queries/god-mode/use-identity-connections";

/**
 * The parent `config_version` is shared by the connection editor, the SCIM settings and the SCIM
 * token routes, so every successful write refreshes the other read. The write returns the new
 * state of its own read, which is cached directly.
 */
export function useIdentityConnectionMutations(connectionId: string) {
  const queryClient = useQueryClient();
  const refreshConnections = () =>
    queryClient.invalidateQueries({ queryKey: identityConnectionsKey });
  const cacheScim = (settings: ScimAdminSettings) =>
    queryClient.setQueryData(scimAdminKey(connectionId), settings);
  const refreshScim = () =>
    queryClient.invalidateQueries({ queryKey: scimAdminKey(connectionId) });

  const create = useMutation({
    mutationFn: createIdentityConnection,
    gcTime: 0,
    onSuccess: refreshConnections,
  });
  const configure = useMutation({
    mutationFn: configureIdentityConnection,
    gcTime: 0,
    onSuccess: (connection: IdentityConnection) => {
      queryClient.setQueryData<IdentityConnection[]>(
        identityConnectionsKey,
        (current) =>
          current?.map((item) =>
            item.id === connection.id ? connection : item,
          ),
      );
      return refreshScim();
    },
  });
  const updateScim = useMutation({
    mutationFn: patchScimAdmin,
    gcTime: 0,
    onSuccess: async (settings: ScimAdminSettings) => {
      cacheScim(settings);
      await refreshConnections();
    },
  });
  const rotateToken = useMutation({
    // The bearer is handed to the caller once and never kept in the mutation cache.
    mutationFn: async (input: {
      id: string;
      version: number;
      token: string;
      onBearer: (bearer: string) => void;
    }) => {
      const { onBearer, ...request } = input;
      const result = await rotateScimBearer(request);
      onBearer(result.token);
      return {
        configVersion: result.configVersion,
        tokenRotatedAt: result.tokenRotatedAt,
      };
    },
    gcTime: 0,
    onSuccess: async () => {
      await Promise.all([refreshConnections(), refreshScim()]);
    },
  });
  const revokeToken = useMutation({
    mutationFn: revokeScimBearer,
    gcTime: 0,
    onSuccess: async () => {
      await Promise.all([refreshConnections(), refreshScim()]);
    },
  });
  return { create, configure, updateScim, rotateToken, revokeToken };
}
