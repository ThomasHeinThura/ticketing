import { useQuery } from "@tanstack/react-query";
import { getMyApiKeys } from "@/fetchers/api-keys";

function useGetApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: getMyApiKeys,
  });
}

export default useGetApiKeys;
