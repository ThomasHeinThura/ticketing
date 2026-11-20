import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeMyApiKey } from "@/fetchers/api-keys";

function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keyId: string) => revokeMyApiKey(keyId),
    meta: {
      audits: {
        targets: () => [
          { kind: "self", audience: "staff", section: "apiKeys" },
        ],
      },
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export default useRevokeApiKey;
