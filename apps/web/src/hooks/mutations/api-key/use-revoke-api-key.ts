import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeMyApiKey } from "@/fetchers/api-keys";
import { capturePersonalSelfHistoryRefresh } from "@/fetchers/settings/personal-history";
import { authClient } from "@/lib/auth-client";

function useRevokeApiKey() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async (keyId: string) => {
      const refreshHistory = capturePersonalSelfHistoryRefresh(
        queryClient,
        "apiKeys",
        "staff",
        session,
      );
      const result = await revokeMyApiKey(keyId);
      refreshHistory();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export default useRevokeApiKey;
