import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, Input, Separator } from "@taskdesk/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useDeleteWorkspace from "@/hooks/mutations/workspace/use-delete-workspace";
import useTransferWorkspaceOwnership from "@/hooks/mutations/workspace/use-transfer-workspace-ownership";
import useUpdateWorkspace from "@/hooks/mutations/workspace/use-update-workspace";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/general",
)({
  component: RouteComponent,
});

type WorkspaceFormValues = {
  name: string;
  description?: string;
};

type NormalizedWorkspaceValues = {
  name: string;
  description: string;
};

function normalizeWorkspaceValues(
  data: WorkspaceFormValues,
): NormalizedWorkspaceValues {
  return {
    name: data.name.trim(),
    description: (data.description ?? "").trim(),
  };
}

// S3 (issue #6, retrofit plan §3): `workspace` here now comes from the
// native GET /api/workspace list (apps/api/src/workspace/response.ts's
// workspaceSummarySchema), where `description` is always a plain column --
// there is no metadata-fallback case left to handle (that was a better-auth
// `additionalFields` quirk on the plugin's own return shape).
function getWorkspaceDescription(
  workspace: { description?: string | null } | null | undefined,
): string {
  return workspace?.description ?? "";
}

function RouteComponent() {
  const { t } = useTranslation();
  const workspaceSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t("settings:workspaceGeneral.validation.nameRequired"))
          .min(2, t("settings:workspaceGeneral.validation.nameShort")),
        description: z.string().optional(),
      }),
    [t],
  );

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<WorkspaceFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedWorkspaceValues | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedNewOwnerId, setSelectedNewOwnerId] = useState<string>("");

  const { user: currentUser } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const { data: fullWorkspace } = useGetFullWorkspace({
    workspaceId: workspace?.id,
  });
  const { mutateAsync: updateWorkspace } = useUpdateWorkspace();
  const { mutateAsync: deleteWorkspace, isPending: isDeleting } =
    useDeleteWorkspace();
  const { mutateAsync: transferOwnership, isPending: isTransferring } =
    useTransferWorkspaceOwnership();
  const { canManageWorkspace, canDeleteWorkspace, isOwner } =
    useWorkspacePermission();
  const canEdit = canManageWorkspace();
  const canDelete = canDeleteWorkspace();
  const workspaceDescription = getWorkspaceDescription(workspace);

  // Ownership transfer is owner-only. Eligible recipients are any current
  // member who isn't the owner themselves.
  //
  // S5 (issue #6, retrofit plan §3) shipped the atomic native
  // transfer-ownership route (apps/api/src/workspace/controllers/
  // transfer-workspace-ownership.ts), keyed by user id, so this no longer
  // needs to be force-disabled. `isOwner` is a client-side convenience only
  // -- the route's own `requireWorkspaceCapability("workspace:transfer_ownership")`
  // middleware and the controller's own re-read of the caller's role are the
  // real authority gate.
  const canTransferOwnership = isOwner;
  const members = fullWorkspace?.members ?? [];
  const currentOwnerMember = members.find((m) => m.role === "owner");
  const eligibleNewOwners = members.filter(
    (m) => m.role !== "owner" && m.id !== currentUser?.id,
  );
  const selectedMember = eligibleNewOwners.find(
    (m) => m.id === selectedNewOwnerId,
  );

  const workspaceForm = useForm<WorkspaceFormValues>({
    resolver: standardSchemaResolver(workspaceSchema),
    mode: "onChange",
    defaultValues: {
      name: workspace?.name || "",
      description: workspaceDescription,
    },
  });

  useEffect(() => {
    if (!workspace) return;

    const nextValues = {
      name: workspace.name || "",
      description: workspaceDescription,
    };
    lastSavedRef.current = normalizeWorkspaceValues(nextValues);

    if (!workspaceForm.formState.isDirty) {
      workspaceForm.reset(nextValues);
    }
  }, [workspace, workspaceDescription, workspaceForm]);

  const saveWorkspace = useCallback(
    async (data: WorkspaceFormValues) => {
      if (!workspace?.id) return;

      const normalizedData = normalizeWorkspaceValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const hasChanges = nameChanged || descriptionChanged;

      if (!hasChanges) return;

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        const updatePayload: {
          workspaceId: string;
          name?: string;
          description?: string;
        } = {
          workspaceId: workspace.id,
        };

        if (nameChanged) {
          updatePayload.name = normalizedData.name;
        }

        if (descriptionChanged) {
          updatePayload.description = normalizedData.description;
        }

        // useUpdateWorkspace's own onSuccess invalidates ["workspaces"] and
        // ["workspace", "full", workspaceId] -- the keys `use-active-workspace`
        // and this page's own `use-get-full-workspace` read -- before this
        // await resolves, so the sidebar and this form don't show the
        // previous name after a rename. See that hook for why (it used to
        // live here, invalidating the dead ["active-organization"] key).
        await updateWorkspace(updatePayload);

        workspaceForm.reset(normalizedData, { keepDirty: false });
        lastSavedRef.current = normalizedData;
        queuedSaveRef.current = null;

        toast.success(t("settings:workspaceGeneral.toastUpdated"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:workspaceGeneral.toastUpdateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveWorkspace(queuedData);
        }
      }
    },
    [workspace, updateWorkspace, workspaceForm, t],
  );

  const handleTransferOwnership = useCallback(async () => {
    // Defense-in-depth: the trigger button and confirm action are both
    // already disabled by !canTransferOwnership (see its declaration above),
    // but refuse here too in case this is ever wired up without that guard.
    if (
      !canTransferOwnership ||
      !workspace?.id ||
      !currentOwnerMember ||
      !selectedMember
    )
      return;

    try {
      await transferOwnership({
        workspaceId: workspace.id,
        newOwnerUserId: selectedMember.id,
      });
      toast.success(
        t("settings:workspaceGeneral.transferOwnership.toastSuccess", {
          defaultValue: "Ownership transferred",
        }),
      );
      setIsTransferModalOpen(false);
      setSelectedNewOwnerId("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.transferOwnership.toastError", {
              defaultValue: "Failed to transfer ownership",
            }),
      );
    }
  }, [
    canTransferOwnership,
    workspace?.id,
    currentOwnerMember,
    selectedMember,
    transferOwnership,
    t,
  ]);

  const handleDeleteWorkspace = useCallback(async () => {
    if (!workspace?.id) return;

    try {
      await deleteWorkspace({ workspaceId: workspace.id });
      toast.success(t("settings:workspaceGeneral.toastDeleted"));

      // Invalidate all workspace-related queries. (["active-organization"]
      // was invalidated here too before -- nothing subscribes to that key,
      // same as the identical dead call removed from saveWorkspace above and
      // from use-transfer-workspace-ownership.ts's onSuccess.)
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });

      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceGeneral.toastDeleteError"),
      );
    }
  }, [workspace?.id, deleteWorkspace, queryClient, navigate, t]);

  const debouncedSave = useCallback(
    (data: WorkspaceFormValues) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(() => {
        saveWorkspace(data);
      }, 1000);
    },
    [saveWorkspace],
  );

  useEffect(() => {
    if (!canEdit) return;
    const subscription = workspaceForm.watch(() => {
      if (workspaceForm.formState.isDirty && workspaceForm.formState.isValid) {
        debouncedSave(workspaceForm.getValues());
      }
    });

    return () => subscription.unsubscribe();
  }, [workspaceForm, debouncedSave, canEdit]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <PageTitle title={t("settings:workspaceGeneral.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceGeneral.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceGeneral.subtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:workspaceGeneral.workspaceInfoTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceGeneral.workspaceInfoSubtitle")}
            </p>
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <Form {...workspaceForm}>
              <form className="space-y-4">
                <FormField
                  control={workspaceForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:workspaceGeneral.nameLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:workspaceGeneral.nameHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:workspaceGeneral.namePlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={workspaceForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:workspaceGeneral.descriptionLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:workspaceGeneral.descriptionHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:workspaceGeneral.descriptionPlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
        </div>

        {isOwner ? (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceGeneral.transferOwnership.title", {
                  defaultValue: "Transfer ownership",
                })}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceGeneral.transferOwnership.subtitle", {
                  defaultValue:
                    "Hand this workspace over to another member. You'll be demoted to admin and lose owner-only abilities.",
                })}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium">
                    {t(
                      "settings:workspaceGeneral.transferOwnership.pickerLabel",
                      { defaultValue: "New owner" },
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {eligibleNewOwners.length === 0
                      ? t(
                          "settings:workspaceGeneral.transferOwnership.noEligibleMembers",
                          {
                            defaultValue:
                              "Invite at least one other member before you can transfer ownership.",
                          },
                        )
                      : t(
                          "settings:workspaceGeneral.transferOwnership.pickerHint",
                          {
                            defaultValue:
                              "They become the sole owner of this workspace.",
                          },
                        )}
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Select
                    value={selectedNewOwnerId}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        setSelectedNewOwnerId(value);
                      }
                    }}
                    disabled={eligibleNewOwners.length === 0}
                  >
                    <SelectTrigger size="sm" className="w-full sm:w-56">
                      <SelectValue
                        placeholder={t(
                          "settings:workspaceGeneral.transferOwnership.pickerPlaceholder",
                          { defaultValue: "Select a member" },
                        )}
                      >
                        {selectedMember
                          ? selectedMember.name || selectedMember.email
                          : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleNewOwners.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={
                      !canTransferOwnership ||
                      !selectedNewOwnerId ||
                      isTransferring
                    }
                    onClick={() => setIsTransferModalOpen(true)}
                  >
                    {t("settings:workspaceGeneral.transferOwnership.button", {
                      defaultValue: "Transfer",
                    })}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {canDelete && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceGeneral.dangerZone")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceGeneral.dangerZoneSubtitle")}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {t("settings:workspaceGeneral.deleteWorkspace")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings:workspaceGeneral.deleteWorkspaceDescription")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive transition-colors"
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                >
                  {t("settings:workspaceGeneral.deleteWorkspace")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <AlertDialog
          open={isTransferModalOpen}
          onOpenChange={setIsTransferModalOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings:workspaceGeneral.transferOwnership.dialogTitle", {
                  defaultValue: "Transfer ownership?",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "settings:workspaceGeneral.transferOwnership.dialogDescription",
                  {
                    defaultValue:
                      "{{name}} will become the sole owner of {{workspace}}. You'll keep admin access but lose owner-only abilities like deleting the workspace or transferring it again.",
                    name: selectedMember?.name || selectedMember?.email || "",
                    workspace: workspace?.name ?? "",
                  },
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isTransferring}
                  />
                }
              >
                {t("common:actions.cancel")}
              </AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    size="sm"
                    disabled={!canTransferOwnership || isTransferring}
                    onClick={handleTransferOwnership}
                  />
                }
              >
                {isTransferring
                  ? t(
                      "settings:workspaceGeneral.transferOwnership.transferring",
                      { defaultValue: "Transferring…" },
                    )
                  : t("settings:workspaceGeneral.transferOwnership.confirm", {
                      defaultValue: "Transfer ownership",
                    })}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={isDeleteModalOpen}
          onOpenChange={setIsDeleteModalOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings:workspaceGeneral.deleteModalTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings:workspaceGeneral.deleteModalDescription", {
                  name: workspace?.name ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                {t("common:actions.cancel")}
              </AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                    onClick={handleDeleteWorkspace}
                  />
                }
              >
                {isDeleting
                  ? t("common:actions.deleting")
                  : t("settings:workspaceGeneral.deleteModalConfirm")}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
