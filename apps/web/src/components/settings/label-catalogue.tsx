import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Label,
} from "@taskdesk/ui";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import PageTitle from "@/components/page-title";
import labelColors from "@/constants/label-colors";
import {
  createProjectLabel,
  deleteProjectLabel,
  getProjectLabels,
  updateProjectLabel,
} from "@/fetchers/label/project-labels";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import useDeleteLabel from "@/hooks/mutations/label/use-delete-label";
import useUpdateLabel from "@/hooks/mutations/label/use-update-label";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { resolveLabelColor } from "@/lib/label-color";
import type { LabelCatalogueSearch } from "@/lib/routes";
import { toast } from "@/lib/toast";

const STABLE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export function LabelCatalogue({
  projectId,
  targetWorkspaceId,
  search,
  onSearchChange,
}: {
  projectId?: string;
  targetWorkspaceId?: string;
  search: LabelCatalogueSearch;
  onSearchChange: (search: LabelCatalogueSearch) => void;
}) {
  const { t } = useTranslation();
  const openPendingAction = useOpenPendingAction();
  const {
    workspace,
    canManageLabels,
    canCreateLabels,
    canUpdateLabels,
    canDeleteLabels,
  } = useWorkspacePermission(targetWorkspaceId, projectId);
  const canCreate = projectId ? canManageLabels() : canCreateLabels();
  const canUpdate = projectId ? canManageLabels() : canUpdateLabels();
  const canDelete = projectId ? canManageLabels() : canDeleteLabels();

  const workspaceId = targetWorkspaceId ?? workspace?.id ?? "";
  const queryClient = useQueryClient();
  const workspaceQuery = useGetLabelsByWorkspace(projectId ? "" : workspaceId);
  const projectQuery = useQuery({
    queryKey: ["project-labels", projectId],
    queryFn: () => getProjectLabels(projectId ?? ""),
    enabled: Boolean(projectId),
  });
  const workspaceLabels = projectId
    ? (projectQuery.data ?? [])
    : (workspaceQuery.data ?? []).filter((label) => !label.taskId);
  const query = projectId ? projectQuery : workspaceQuery;
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["project-labels", projectId],
      }),
      queryClient.invalidateQueries({ queryKey: ["labels", workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["work-items"] }),
    ]);
  };
  const workspaceCreate = useCreateLabel();
  const workspaceUpdate = useUpdateLabel();
  const workspaceDelete = useDeleteLabel();
  const projectCreate = useMutation({
    mutationFn: (values: {
      name: string;
      color: string;
      workspaceId?: string;
    }) =>
      createProjectLabel(projectId ?? "", {
        name: values.name,
        color: values.color,
      }),
    onSuccess: invalidate,
  });
  const projectUpdate = useMutation({
    mutationFn: ({
      id,
      ...values
    }: {
      id: string;
      name: string;
      color: string;
    }) => updateProjectLabel(projectId ?? "", id, values),
    onSuccess: invalidate,
  });
  const projectDelete = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      deleteProjectLabel(projectId ?? "", id),
  });
  const createLabel = projectId ? projectCreate : workspaceCreate;
  const updateLabel = projectId ? projectUpdate : workspaceUpdate;
  const deleteLabel = projectId ? projectDelete : workspaceDelete;
  const createOpen = search.action === "create" && canCreate;
  const binding = `${projectId ?? workspaceId}:${search.action ?? ""}:${search.label ?? ""}`;
  const bindingEpoch = useRef({ key: binding, epoch: 0 });
  if (bindingEpoch.current.key !== binding) {
    bindingEpoch.current = {
      key: binding,
      epoch: bindingEpoch.current.epoch + 1,
    };
  }
  const liveBinding = useRef<string | undefined>(undefined);
  liveBinding.current = `${binding}:${bindingEpoch.current.epoch}`;
  useEffect(() => {
    liveBinding.current = `${bindingEpoch.current.key}:${bindingEpoch.current.epoch}`;
    return () => {
      liveBinding.current = undefined;
    };
  }, []);
  const close = () => onSearchChange({});
  const setCreateOpen = (open: boolean) => {
    if (!open) close();
  };
  const setEditOpen = (open: boolean) => {
    if (!open) close();
  };
  const setDeleteOpen = (open: boolean) => {
    if (!open) close();
  };

  // Create dialog state
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newColor, setNewColor] = useState("gray");
  const [createError, setCreateError] = useState("");
  const [createKeyError, setCreateKeyError] = useState("");

  // Edit dialog state
  const [editingLabel, setEditingLabel] = useState<{
    id: string;
    name: string;
    color: string;
    key?: string | null;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("gray");
  const [editError, setEditError] = useState("");

  // Delete dialog state
  const [deletingLabel, setDeletingLabel] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const targetExists = workspaceLabels.some(
    (label) => label.id === search.label,
  );
  const editOpen =
    search.action === "edit" &&
    canUpdate &&
    targetExists &&
    editingLabel?.id === search.label;
  const deleteOpen =
    search.action === "delete" &&
    canDelete &&
    targetExists &&
    deletingLabel?.id === search.label;

  const hydratedBinding = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (hydratedBinding.current === binding) return;
    if (search.action === "edit" || search.action === "delete") {
      const selected = workspaceLabels.find(
        (label) => label.id === search.label,
      );
      if (!selected) return;
      if (search.action === "edit") {
        setEditingLabel(selected);
        setEditName(selected.name);
        setEditColor(selected.color);
        setEditError("");
      } else setDeletingLabel(selected);
    }
    hydratedBinding.current = binding;
  }, [binding, search.action, search.label, workspaceLabels]);

  const resetCreate = () => {
    setNewName("");
    setNewKey("");
    setNewColor("gray");
    setCreateError("");
    setCreateKeyError("");
  };

  const openCreate = () => {
    resetCreate();
    onSearchChange({ action: "create" });
  };

  const handleCreate = async () => {
    const submittedBinding = liveBinding.current;
    if (!submittedBinding) return;
    const trimmed = newName.trim();
    const stableKey = newKey.trim();
    if (!trimmed) {
      setCreateError(
        t("settings:workspaceLabels.nameRequired", {
          defaultValue: "Label name is required",
        }),
      );
      return;
    }
    if (!projectId && !STABLE_KEY_PATTERN.test(stableKey)) {
      setCreateKeyError(t("settings:workspaceLabels.stableKeyInvalid"));
      return;
    }

    try {
      await createLabel.mutateAsync({
        name: trimmed,
        color: newColor,
        workspaceId,
        ...(!projectId ? { key: stableKey } : {}),
      });
      if (liveBinding.current !== submittedBinding) return;
      toast.success(
        t("settings:workspaceLabels.createSuccess", {
          defaultValue: "Label created",
        }),
      );
      setCreateOpen(false);
      resetCreate();
    } catch (error) {
      if (liveBinding.current !== submittedBinding) return;
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceLabels.createError", {
              defaultValue: "Failed to create label",
            }),
      );
    }
  };

  const openEdit = (label: {
    id: string;
    name: string;
    color: string;
    key?: string | null;
  }) => {
    setEditingLabel(label);
    setEditName(label.name);
    setEditColor(label.color);
    setEditError("");
    onSearchChange({ action: "edit", label: label.id });
  };

  const handleEdit = async () => {
    const submittedBinding = liveBinding.current;
    if (!submittedBinding) return;
    if (!editingLabel) return;

    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(
        t("settings:workspaceLabels.nameRequired", {
          defaultValue: "Label name is required",
        }),
      );
      return;
    }

    try {
      await updateLabel.mutateAsync({
        id: editingLabel.id,
        name: trimmed,
        color: editColor,
      });
      if (liveBinding.current !== submittedBinding) return;
      toast.success(
        t("settings:workspaceLabels.updateSuccess", {
          defaultValue: "Label updated",
        }),
      );
      setEditOpen(false);
      setEditingLabel(null);
    } catch (error) {
      if (liveBinding.current !== submittedBinding) return;
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceLabels.updateError", {
              defaultValue: "Failed to update label",
            }),
      );
    }
  };

  /**
   * The delete button requests the deletion at once and the approval dialog is the single
   * confirmation (PA-3). A `?action=delete&label=` link still opens its own confirmation,
   * so a link never creates a pending action by itself.
   */
  const handleDelete = async (
    target: { id: string; name: string } | null = deletingLabel,
  ) => {
    const submittedBinding = liveBinding.current;
    if (!submittedBinding) return;
    if (!target) return;

    try {
      // Deletion is only requested; the label stays until the requester approves it.
      const pendingAction = await deleteLabel.mutateAsync({
        id: target.id,
      });
      if (liveBinding.current !== submittedBinding) return;
      if (deleteOpen) setDeleteOpen(false);
      setDeletingLabel(null);
      await openPendingAction(pendingAction);
    } catch (error) {
      if (liveBinding.current !== submittedBinding) return;
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceLabels.deleteError", {
              defaultValue: "Failed to delete label",
            }),
      );
    }
  };

  return (
    <>
      <PageTitle title={t("settings:workspaceLabels.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8 bg-card">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceLabels.title", { defaultValue: "Labels" })}
          </h1>
          <p className="text-muted-foreground">
            {t(
              projectId
                ? "settings:projectLabels.subtitle"
                : "settings:workspaceLabels.subtitle",
              {
                defaultValue:
                  "Create, edit, and delete workspace-level labels.",
              },
            )}
          </p>
        </div>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <Tag className="size-4" />
                {t("settings:workspaceLabels.title", {
                  defaultValue: "Labels",
                })}
              </CardTitle>
              <CardDescription>
                {t("settings:workspaceLabels.cardDescription", {
                  defaultValue: "Manage labels that can be assigned to tasks.",
                })}
              </CardDescription>
              {canCreate && (
                <CardAction>
                  <Button onClick={openCreate} className="gap-2">
                    <Plus className="size-4" />
                    {t("settings:workspaceLabels.createLabel", {
                      defaultValue: "Create Label",
                    })}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
          </Card>

          <Card className="!rounded-none">
            <CardPanel>
              {query.isError ? (
                <div role="alert" className="space-y-2">
                  <p>
                    {query.error instanceof Error
                      ? query.error.message
                      : t("common:error.messages.unknown")}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void query.refetch()}
                  >
                    {t("common:actions.retry")}
                  </Button>
                </div>
              ) : query.isPending ? (
                <p role="status">{t("settings:projectLabels.loading")}</p>
              ) : workspaceLabels.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <Tag className="size-8 text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t("settings:workspaceLabels.empty", {
                        defaultValue:
                          "No labels yet. Create your first label to get started.",
                      })}
                    </EmptyTitle>
                    <EmptyDescription />
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="divide-y divide-border">
                  {workspaceLabels.map((label) => (
                    <div
                      key={label.id}
                      className="flex items-center justify-between py-2.5 px-1"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: resolveLabelColor(label.color),
                          }}
                        />
                        <span className="text-sm truncate">{label.name}</span>
                      </div>
                      {(canUpdate || canDelete) && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceLabels.editLabel",
                                { defaultValue: "Edit Label" },
                              )}
                              className="h-8 w-8"
                              onClick={() =>
                                openEdit({
                                  id: label.id,
                                  name: label.name,
                                  color: label.color,
                                  key: label.key,
                                })
                              }
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceLabels.deleteLabel",
                                { defaultValue: "Delete" },
                              )}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              disabled={deleteLabel.isPending}
                              onClick={() =>
                                void handleDelete({
                                  id: label.id,
                                  name: label.name,
                                })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardPanel>
          </Card>
        </CardFrame>
      </div>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !open && setCreateOpen(false)}
      >
        <DialogContent
          className="sm:max-w-md"
          closeLabel={t("common:actions.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceLabels.createLabel", {
                defaultValue: "Create Label",
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                projectId
                  ? "settings:projectLabels.createDescription"
                  : "settings:workspaceLabels.createDescription",
                {
                  defaultValue:
                    "Create a new label that can be used across tasks in this workspace.",
                },
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-label-name">
                {t("settings:workspaceLabels.nameLabel", {
                  defaultValue: "Label name",
                })}
              </Label>
              <Input
                id="new-label-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError("");
                }}
                placeholder={t("settings:workspaceLabels.namePlaceholder", {
                  defaultValue: "Enter label name",
                })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !createLabel.isPending)
                    handleCreate();
                }}
              />
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
            </div>

            {!projectId ? (
              <div className="space-y-2">
                <Label htmlFor="new-label-key">
                  {t("settings:workspaceLabels.stableKeyLabel")}
                </Label>
                <Input
                  id="new-label-key"
                  value={newKey}
                  maxLength={64}
                  autoComplete="off"
                  aria-invalid={Boolean(createKeyError)}
                  onChange={(event) => {
                    setNewKey(event.target.value);
                    setCreateKeyError("");
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings:workspaceLabels.stableKeyHelp")}
                </p>
                {createKeyError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {createKeyError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>
                {t("settings:workspaceLabels.colorLabel", {
                  defaultValue: "Color",
                })}
              </Label>
              <div className="flex flex-wrap gap-2">
                {labelColors.map((c) => (
                  <ActionTooltip key={c.value} label={c.label}>
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={c.label}
                      aria-pressed={newColor === c.value}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-[scale,border-color]",
                        newColor === c.value
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-110",
                      )}
                      style={{ backgroundColor: c.color }}
                      onClick={() => setNewColor(c.value)}
                    />
                  </ActionTooltip>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common:actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button onClick={handleCreate} disabled={createLabel.isPending}>
              {t("settings:workspaceLabels.createLabel", {
                defaultValue: "Create Label",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditOpen(false);
            setEditingLabel(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          closeLabel={t("common:actions.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceLabels.editLabel", {
                defaultValue: "Edit Label",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workspaceLabels.editDescription", {
                defaultValue: "Update the name or color of this label.",
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-label-name">
                {t("settings:workspaceLabels.nameLabel", {
                  defaultValue: "Label name",
                })}
              </Label>
              <Input
                id="edit-label-name"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setEditError("");
                }}
                placeholder={t("settings:workspaceLabels.namePlaceholder", {
                  defaultValue: "Enter label name",
                })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !updateLabel.isPending) handleEdit();
                }}
              />
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
            </div>

            {!projectId ? (
              <div className="space-y-2">
                <Label htmlFor="edit-label-key">
                  {t("settings:workspaceLabels.stableKeyReadOnlyLabel")}
                </Label>
                <Input
                  id="edit-label-key"
                  value={editingLabel?.key ?? ""}
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings:workspaceLabels.stableKeyHelp")}
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>
                {t("settings:workspaceLabels.colorLabel", {
                  defaultValue: "Color",
                })}
              </Label>
              <div className="flex flex-wrap gap-2">
                {labelColors.map((c) => (
                  <ActionTooltip key={c.value} label={c.label}>
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={c.label}
                      aria-pressed={editColor === c.value}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-[scale,border-color]",
                        editColor === c.value
                          ? "border-foreground scale-110"
                          : "border-transparent hover:scale-110",
                      )}
                      style={{ backgroundColor: c.color }}
                      onClick={() => setEditColor(c.value)}
                    />
                  </ActionTooltip>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditingLabel(null);
              }}
            >
              {t("common:actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button onClick={handleEdit} disabled={updateLabel.isPending}>
              {t("settings:workspaceLabels.saveLabel", {
                defaultValue: "Save",
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeletingLabel(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceLabels.deleteConfirmTitle", {
                defaultValue: "Delete this label?",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                projectId
                  ? "settings:projectLabels.deleteConfirmDescription"
                  : "settings:workspaceLabels.deleteConfirmDescription",
                {
                  defaultValue:
                    "Any tasks using this label will have it removed. This action cannot be undone.",
                },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeletingLabel(null);
              }}
            >
              {t("common:actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteLabel.isPending}
            >
              {t("settings:workspaceLabels.deleteLabel", {
                defaultValue: "Delete",
              })}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
