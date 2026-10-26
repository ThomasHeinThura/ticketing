import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import requestWorkItemDeletion from "@/fetchers/work-item/request-work-item-deletion";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { workItemMutationScope } from "./work-item-save";

/**
 * Shared pending-action request; no caller can turn a request into direct deletion. The
 * approval opens in place on the current screen (PA-3), never as a page navigation.
 */
export function useWorkItemDeletion(
  item: { key: string; workspaceId: string; projectId: string },
  onAccessLost: () => void,
) {
  const openPendingAction = useOpenPendingAction();
  const permission = useWorkspacePermission(item.workspaceId, item.projectId);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const lifecycle = useIntentLifecycle(
    `${item.workspaceId}:${item.projectId}:${item.key}`,
    () => setFailed(false),
  );
  const mutation = useMutation({
    scope: workItemMutationScope(item.key),
    mutationFn: requestWorkItemDeletion,
  });
  const canRequest =
    !permission.isCheckingPermissions && permission.canDeleteTasks();
  async function requestDeletion(finalFocus?: () => HTMLElement | false) {
    if (!canRequest || mutation.isPending || busy.current) return;
    busy.current = true;
    const intent = lifecycle.capture();
    setFailed(false);
    try {
      const action = await mutation.mutateAsync(item.key);
      if (!lifecycle.isCurrent(intent)) return;
      await openPendingAction(finalFocus ? { ...action, finalFocus } : action);
    } catch (error) {
      if (!lifecycle.isCurrent(intent)) return;
      if (error instanceof HttpError && error.status === 404) onAccessLost();
      else setFailed(true);
    } finally {
      busy.current = false;
    }
  }
  return { canRequest, failed, isPending: mutation.isPending, requestDeletion };
}
