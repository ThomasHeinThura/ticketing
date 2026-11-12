import { useEffect, useState } from "react";
import { type RecentItem, resolveRecentItems } from "./recent-items";

export function useRecentItems(
  open: boolean,
  userId?: string,
  workspaceId?: string,
) {
  const [state, setState] = useState<{
    userId: string;
    workspaceId: string;
    items: RecentItem[];
  } | null>(null);
  useEffect(() => {
    setState(null);
    if (!open || !userId || !workspaceId) return;
    const controller = new AbortController();
    void resolveRecentItems(userId, workspaceId, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted)
          setState({ userId, workspaceId, items: result });
      },
    );
    return () => controller.abort();
  }, [open, userId, workspaceId]);
  return open &&
    state !== null &&
    state.userId === userId &&
    state.workspaceId === workspaceId
    ? state.items
    : [];
}
