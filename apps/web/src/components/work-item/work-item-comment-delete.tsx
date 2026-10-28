import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@taskdesk/ui";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import requestCommentDeletion from "@/fetchers/work-item/request-comment-deletion";
import { useIntentLifecycle } from "@/hooks/use-intent-lifecycle";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";

/** Requests a durable action; the in-place approval dialog owns the explicit destructive click. */
export function WorkItemCommentDelete({
  workItemKey,
  commentId,
  canDelete,
}: {
  workItemKey: string;
  commentId: string;
  canDelete: boolean;
}) {
  const { t } = useTranslation();
  const openPendingAction = useOpenPendingAction();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const lifecycle = useIntentLifecycle(
    `${workItemKey}:${commentId}:${canDelete}`,
    () => {
      setFailed(false);
      setPending(false);
    },
  );
  async function request() {
    if (!canDelete || busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    const intent = lifecycle.capture();
    try {
      const result = await requestCommentDeletion(commentId);
      if (!lifecycle.isCurrent(intent)) return;
      await openPendingAction(result);
    } catch {
      if (lifecycle.isCurrent(intent)) setFailed(true);
    } finally {
      busy.current = false;
      if (lifecycle.isCurrent(intent)) setPending(false);
    }
  }
  if (!canDelete) return null;
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-destructive"
              aria-label={t("common:actions.delete")}
              disabled={pending}
              onClick={() => void request()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common:actions.delete")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {t("workItems:deletion.requestFailed")}
        </span>
      )}
    </>
  );
}
