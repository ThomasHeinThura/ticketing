import { QueryClient } from "@tanstack/react-query";

// The customer portal has its own route tree and sign-in flow. Reuse the same
// per-app cache patterns without the agent client's unauthorized redirect.
const portalQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export default portalQueryClient;
