import type { QueryClient, QueryKey } from "@tanstack/react-query";

export function refreshSettingsHistory(
  client: QueryClient,
  key: QueryKey,
  canRefresh: () => Promise<void>,
) {
  const cancelled = client.cancelQueries({ queryKey: key, exact: true });
  void client
    .invalidateQueries({ queryKey: key, exact: true, refetchType: "none" })
    .catch(() => {});
  void cancelled
    .then(canRefresh)
    .then(() =>
      client.invalidateQueries({
        queryKey: key,
        exact: true,
        refetchType: "active",
      }),
    )
    .catch(() => {});
}
