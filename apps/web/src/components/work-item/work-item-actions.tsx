import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkItemDeletion } from "./use-work-item-deletion";

export default function WorkItemActions({
  item,
  onAccessLost,
  variant = "menu",
}: {
  item: { key: string; workspaceId: string; projectId: string };
  onAccessLost: () => void;
  variant?: "menu" | "delete";
}) {
  const { t } = useTranslation();
  const { canRequest, failed, isPending, requestDeletion } =
    useWorkItemDeletion(item, onAccessLost);
  if (!canRequest) return null;

  return (
    <div className="flex items-center gap-2">
      {variant === "delete" ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-foreground"
          aria-label={t("tasks:actions.delete")}
          disabled={isPending}
          onClick={() => void requestDeletion()}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
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
            <DropdownMenuItem onClick={() => void requestDeletion()}>
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
