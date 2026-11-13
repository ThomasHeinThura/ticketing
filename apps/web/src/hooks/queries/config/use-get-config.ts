import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@/fetchers/config/get-config";

function useGetConfig(refetchOnMount?: "always") {
  return useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    ...(refetchOnMount ? { refetchOnMount } : {}),
  });
}

export default useGetConfig;
