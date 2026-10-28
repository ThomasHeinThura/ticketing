import { useMutation, useQueryClient } from "@tanstack/react-query";
import { revokeMyApiKey } from "@/fetchers/api-keys";

function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (keyId: string) => revokeMyApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

export default useRevokeApiKey;
