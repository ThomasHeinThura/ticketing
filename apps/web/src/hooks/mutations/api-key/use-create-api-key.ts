import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { createMyApiKey } from "@/fetchers/api-keys";
import type { CreateApiKeyClientRequest } from "@/types/api-key";

function useCreateApiKey() {
  const queryClient = useQueryClient();

  const created = useRef<Awaited<ReturnType<typeof createMyApiKey>> | null>(
    null,
  );
  const pending = useRef(false);
  const mutation = useMutation({
    mutationFn: async (data: CreateApiKeyClientRequest) => {
      created.current = await createMyApiKey(data);
    },
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
  return {
    ...mutation,
    mutateAsync: async (data: CreateApiKeyClientRequest) => {
      if (pending.current) throw new Error("API key creation already pending");
      pending.current = true;
      try {
        await mutation.mutateAsync(data);
        if (!created.current)
          throw new Error("API key creation returned no key");
        return created.current;
      } finally {
        created.current = null;
        pending.current = false;
      }
    },
  };
}

export default useCreateApiKey;
