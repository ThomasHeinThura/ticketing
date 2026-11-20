import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const preferencesHistoryKey = (
  userId: string,
  sessionId: string,
  host = window.location.host,
) =>
  [
    "personal-settings-history",
    host,
    "preferences",
    userId,
    sessionId,
  ] as const;

export function capturePreferencesHistoryRefresh(
  client: QueryClient,
  identity?: { user?: { id: string }; session?: { id: string } } | null,
) {
  const userId = identity?.user?.id;
  const sessionId = identity?.session?.id;
  const host = window.location.host;
  if (!userId || !sessionId) return () => {};
  const key = preferencesHistoryKey(userId, sessionId, host);
  return () => refreshPersonalHistory(client, key);
}

export function refreshPersonalHistory(client: QueryClient, key: QueryKey) {
  void client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData(key, null);
  void client
    .invalidateQueries({ queryKey: key, exact: true, refetchType: "active" })
    .catch(() => {});
}
