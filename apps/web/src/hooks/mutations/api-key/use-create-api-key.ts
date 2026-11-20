import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMyApiKey } from "@/fetchers/api-keys";
import { capturePersonalSelfHistoryRefresh } from "@/fetchers/settings/personal-history";
import { authClient } from "@/lib/auth-client";
import type { CreateApiKeyClientRequest } from "@/types/api-key";

function useCreateApiKey() {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  return useMutation({
    mutationFn: async (data: CreateApiKeyClientRequest) => {
      const refreshHistory = capturePersonalSelfHistoryRefresh(
        queryClient,
        "apiKeys",
        "staff",
        session,
      );
      const result = await createMyApiKey(data);
      refreshHistory();
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export default useCreateApiKey;
