import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import moveWorkItem from "@/fetchers/work-item/move-work-item";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import { currentWorkItemVersion } from "./work-item-save";

type Props = {
  item: WorkItemDetailRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the item's new key after a successful move. */
  onMoved?: (newKey: string) => void;
};

/**
 * `RH-12`: moves a work item to another project of the same workspace. The consequences are
 * stated plainly before confirming: the item gets a new key (the old key keeps redirecting),
 * its parent link is removed, and sub-items either move along or stay behind with no parent.
 * The server refuses (422) when the target project lacks a matching state or the assignee is
 * not on its roster, and the message is shown as-is.
 */
export default function MoveWorkItemDialog({
  item,
  open,
  onOpenChange,
  onMoved,
}: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const projects = useGetProjects({ workspaceId: item.workspaceId }, open);
  const [targetId, setTargetId] = useState<string>("");
  const [moveChildren, setMoveChildren] = useState(true);
  const candidates = (projects.data ?? []).filter(
    (project) => project.id !== item.projectId && !project.archivedAt,
  );
  const target = candidates.find((project) => project.id === targetId);
  const source = (projects.data ?? []).find(
    (project) => project.id === item.projectId,
  );
  const mutation = useMutation({
    mutationFn: () =>
      moveWorkItem({
        key: item.key,
        version: currentWorkItemVersion(client, item),
        targetProjectId: targetId,
        moveChildren,
      }),
    onSuccess: async (result) => {
      const newKey = result.item.key;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["work-items"] }),
        client.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success(t("workItems:move.success", { key: newKey }));
      onOpenChange(false);
      onMoved?.(newKey);
    },
  });
  const error = mutation.error;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          if (!next) mutation.reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent closeLabel={t("common:actions.close")}>
        <DialogHeader>
          <DialogTitle>
            {t("workItems:move.title", { key: item.key })}
          </DialogTitle>
          <DialogDescription>
            {t("workItems:move.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6">
          <div className="space-y-2">
            <Label htmlFor="move-target-project">
              {t("workItems:move.target")}
            </Label>
            <Select
              value={targetId}
              disabled={mutation.isPending || projects.isLoading}
              onValueChange={(value) => setTargetId(value ?? "")}
            >
              <SelectTrigger id="move-target-project">
                <SelectValue
                  placeholder={t("workItems:move.targetPlaceholder")}
                >
                  {target?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {candidates.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {projects.isError ? (
              <p className="text-sm text-destructive">
                {t("workItems:move.projectsFailed")}
              </p>
            ) : null}
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="move-children"
              checked={moveChildren}
              disabled={mutation.isPending}
              onCheckedChange={(value) => setMoveChildren(Boolean(value))}
            />
            <Label htmlFor="move-children" className="font-normal">
              {t("workItems:move.children")}
            </Label>
          </div>
          <p className="text-sm text-muted-foreground">
            {moveChildren
              ? t("workItems:move.childrenMoveHelp")
              : t("workItems:move.childrenDetachHelp", {
                  project: source?.name ?? "",
                })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("workItems:move.consequences")}
          </p>
          {error ? (
            <Alert variant="error">
              <AlertDescription>
                {error instanceof WorkItemVersionConflictError
                  ? t("workItems:properties.conflict")
                  : error instanceof HttpError && error.status === 404
                    ? t("workItems:move.notFound")
                    : error instanceof Error && error.message
                      ? error.message
                      : t("workItems:move.failed")}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button
            disabled={!targetId || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("workItems:move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
