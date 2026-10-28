import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useWorkItemDeletion } from "./use-work-item-deletion";

export default function WorkItemActions({
  item,
  onAccessLost,
  variant = "menu",
}: {
  item: {
    key: string;
    workspaceId: string;
    projectId: string;
    archivedAt?: string | null;
  };
  onAccessLost: () => void;
  variant?: "menu" | "delete";
}) {
  const { t } = useTranslation();
  const { canRequest, failed, isPending, requestDeletion } =
    useWorkItemDeletion(item, onAccessLost);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  if (!canRequest || item.archivedAt) return null;

  function connectedFocusTarget(
    target: HTMLButtonElement | null,
  ): () => HTMLElement | false {
    return () => (target?.isConnected ? target : false);
  }

  return (
    <div className="flex items-center gap-2">
      {variant === "delete" ? (
        <Button
          ref={deleteButtonRef}
          variant="ghost"
          size="sm"
          className="text-foreground"
          aria-label={t("tasks:actions.delete")}
          disabled={isPending}
          onClick={() =>
            void requestDeletion(connectedFocusTarget(deleteButtonRef.current))
          }
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                size="sm"
                aria-label={t("workItems:deletion.actions")}
                disabled={isPending}
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                void requestDeletion(
                  connectedFocusTarget(menuTriggerRef.current),
                )
              }
            >
              <Trash2 className="size-4" />
              {t("tasks:actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("workItems:deletion.requestFailed")}
        </p>
      )}
    </div>
  );
}
