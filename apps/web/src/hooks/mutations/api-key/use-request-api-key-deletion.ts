import { useMutation } from "@tanstack/react-query";
import { requestDeleteMyApiKey } from "@/fetchers/api-keys";

export default function useRequestApiKeyDeletion() {
  return useMutation({ mutationFn: requestDeleteMyApiKey });
}
