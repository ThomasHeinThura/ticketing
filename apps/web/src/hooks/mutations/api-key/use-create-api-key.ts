import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMyApiKey } from "@/fetchers/api-keys";
import type { CreateApiKeyClientRequest } from "@/types/api-key";

function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyClientRequest) => createMyApiKey(data),
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

export default useCreateApiKey;
