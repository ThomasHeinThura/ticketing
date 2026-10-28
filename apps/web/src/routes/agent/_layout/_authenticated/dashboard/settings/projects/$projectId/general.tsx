import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from "@taskdesk/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import PageTitle from "@/components/page-title";
import DefaultCommentVisibilitySetting from "@/components/project/default-comment-visibility-setting";
import ProjectEngagementSettings from "@/components/project/project-engagement-settings";
import {
  classifyPlanningFailure,
  projectKeyError,
} from "@/components/project/project-planning-form";
import ProjectPlanningSettings from "@/components/project/project-planning-settings";
import { TasksImportExport } from "@/components/project/tasks-import-export.tsx";
import icons from "@/constants/project-icons";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project.ts";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/general",
)({
  component: RouteComponent,
});

type ProjectFormValues = {
  name: string;
  slug: string;
  description?: string;
  icon: string;
};

type NormalizedProjectValues = {
  name: string;
  slug: string;
  description: string;
  icon: string;
};

function normalizeProjectValues(
  data: ProjectFormValues,
): NormalizedProjectValues {
  return {
    name: data.name.trim(),
    slug: data.slug.trim(),
    description: (data.description ?? "").trim(),
    icon: data.icon || "Layout",
  };
}

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams({ strict: false });
  const { project: storedProject } = useProjectStore();
  // PR-13: a key is 2-8 uppercase letters. The project's own stored key stays valid while
  // unchanged (legacy keys predate the rule); the server applies the same exemption.
  const storedKey =
    storedProject?.id === routeProjectId ? (storedProject?.slug ?? null) : null;
  const projectSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("settings:projectGeneral.validation.nameRequired")),
        slug: z.string().superRefine((value, ctx) => {
          const problem = projectKeyError(value, storedKey);
          if (problem === "required") {
            ctx.addIssue({
              code: "custom",
              message: t("settings:projectGeneral.validation.keyRequired"),
            });
          } else if (problem === "format") {
            ctx.addIssue({
              code: "custom",
              message: t("settings:projectGeneral.validation.keyFormat"),
            });
          }
        }),
        description: z.string().optional(),
        icon: z
          .string()
          .min(1, t("settings:projectGeneral.validation.iconRequired")),
      }),
    [t, storedKey],
  );

  const queryClient = useQueryClient();
  const openPendingAction = useOpenPendingAction();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<ProjectFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedProjectValues | null>(null);
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [renameKeyOpen, setRenameKeyOpen] = useState(false);
  const [isRenamingKey, setIsRenamingKey] = useState(false);

  const { data: workspace } = useActiveWorkspace();
  const { projectId: rawProjectId } = useParams({ strict: false });
  const projectId = rawProjectId ?? "";
  const { data: fetchedProject } = useGetTasks(projectId);
  const { project, setProject } = useProjectStore();

  useEffect(() => {
    if (fetchedProject) {
      setProject(fetchedProject);
    }
  }, [fetchedProject, setProject]);

  const { mutateAsync: updateProject } = useUpdateProject();
  const { mutateAsync: deleteProject, isPending: isDeleting } =
    useDeleteProject();
  const deleteProjectButtonRef = useRef<HTMLButtonElement>(null);
  const { canManageProjects, canDeleteProjects } = useWorkspacePermission();
  const canEdit = canManageProjects();
  const canDelete = canDeleteProjects();

  const projectForm = useForm<ProjectFormValues>({
    resolver: standardSchemaResolver(projectSchema),
    mode: "onChange",
    defaultValues: {
      name: project?.name || "",
      slug: project?.slug || "",
      description: project?.description || "",
      icon: project?.icon || "Layout",
    },
  });

  useEffect(() => {
    if (!project) return;

    const nextValues = {
      name: project.name || "",
      slug: project.slug || "",
      description: project.description || "",
      icon: project.icon || "Layout",
    };
    lastSavedRef.current = normalizeProjectValues(nextValues);

    if (projectForm.formState.isDirty) return;

    projectForm.reset(nextValues, {
      keepDirty: false,
      keepTouched: false,
      keepIsValid: true,
    });
  }, [project, projectForm]);

  // PR-14: renaming the key is allowed but discouraged (existing work items keep the old
  // prefix), so it is NEVER part of the debounced autosave or the navigate-away flush: it
  // goes through `confirmRenameKey` below after an explicit confirmation. Everything else
  // autosaves as before, always sending the key the project already has.
  const saveProject = useCallback(
    async (data: ProjectFormValues) => {
      if (!project?.id) return;

      const normalizedData = normalizeProjectValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const iconChanged = lastSavedRef.current?.icon !== normalizedData.icon;
      const hasChanges = nameChanged || descriptionChanged || iconChanged;

      if (!hasChanges) return;

      if (isSavingRef.current) {
        queuedSaveRef.current = data;
        return;
      }

      isSavingRef.current = true;

      try {
        const updatePayload = {
          id: project.id,
          name: nameChanged ? normalizedData.name : project.name,
          // The last persisted key, never the store's possibly stale one, so an autosave
          // cannot undo a rename that was just confirmed.
          slug: lastSavedRef.current?.slug ?? project.slug,
          description: descriptionChanged
            ? normalizedData.description
            : (project.description ?? ""),
          icon: iconChanged ? normalizedData.icon : (project.icon ?? "Layout"),
        };

        await updateProject(updatePayload);

        // Keep the typed (unconfirmed) key in the form; only the other fields are saved.
        projectForm.reset(normalizedData, { keepDirty: false });
        lastSavedRef.current = {
          ...normalizedData,
          slug: lastSavedRef.current?.slug ?? project.slug,
        };
        queuedSaveRef.current = null;

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspace?.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspace?.id, project.id],
          }),
        ]);
        toast.success(t("settings:projectGeneral.toastUpdated"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("settings:projectGeneral.toastUpdateError"),
        );
      } finally {
        isSavingRef.current = false;

        if (queuedSaveRef.current) {
          const queuedData = queuedSaveRef.current;
          queuedSaveRef.current = null;
          await saveProject(queuedData);
        }
      }
    },
    [
      project?.id,
      project?.name,
      project?.slug,
      project?.description,
      project?.icon,
      updateProject,
      queryClient,
      workspace?.id,
      projectForm,
      t,
    ],
  );

  const pendingKey = (projectForm.watch("slug") ?? "").trim();
  // The persisted key: the last one this page saved, else the loaded project's.
  const persistedKey = lastSavedRef.current?.slug ?? project?.slug ?? "";
  const keyChanged = Boolean(persistedKey) && pendingKey !== persistedKey;
  const keyProblem = projectKeyError(pendingKey, persistedKey);

  const confirmRenameKey = useCallback(async () => {
    if (!project?.id) return;
    const next = normalizeProjectValues(
      projectForm.getValues() as ProjectFormValues,
    );
    if (projectKeyError(next.slug, persistedKey) !== null) return;
    setIsRenamingKey(true);
    try {
      await updateProject({
        id: project.id,
        name: next.name,
        slug: next.slug,
        description: next.description,
        icon: next.icon,
      });
      lastSavedRef.current = next;
      projectForm.reset(next, { keepDirty: false });
      // The store is fed by the legacy board query; update it now so nothing keeps using the
      // old key until that query refetches.
      setProject({
        ...project,
        name: next.name,
        slug: next.slug,
        description: next.description,
        icon: next.icon,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tasks", project.id] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({
          queryKey: ["projects", workspace?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", workspace?.id, project.id],
        }),
      ]);
      setRenameKeyOpen(false);
      toast.success(t("settings:projectGeneral.keyRenamed"));
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? classifyPlanningFailure(error.status, error.message)
          : "generic";
      setRenameKeyOpen(false);
      toast.error(
        failure === "keyTaken"
          ? t("settings:projectGeneral.keyTaken")
          : failure === "keyFormat"
            ? t("settings:projectGeneral.validation.keyFormat")
            : t("settings:projectGeneral.toastUpdateError"),
      );
    } finally {
      setIsRenamingKey(false);
    }
  }, [
    project,
    persistedKey,
    projectForm,
    updateProject,
    queryClient,
    setProject,
    workspace?.id,
    t,
  ]);

  const saveProjectRef = useRef(saveProject);
  const projectFormRef = useRef(projectForm);
  saveProjectRef.current = saveProject;
  projectFormRef.current = projectForm;

  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      // The key is confirmed separately (PR-14), so an unconfirmed or invalid key never
      // blocks the autosave of the other fields.
      const isValid = await projectForm.trigger([
        "name",
        "description",
        "icon",
      ]);
      if (isValid) {
        // Always save latest values to avoid staleness while typing
        const latest = projectForm.getValues();
        saveProject(latest as ProjectFormValues);
      }
    }, 800);
  }, [projectForm, saveProject]);

  useEffect(() => {
    if (!canEdit) return;
    // Do not gate on formState.isDirty here: after setValue (e.g. icon pick), the
    // watch callback can run before RHF updates isDirty, so the debounced save never runs.
    const subscription = projectForm.watch(() => {
      debouncedSave();
    });

    return () => subscription.unsubscribe();
  }, [projectForm, debouncedSave, canEdit]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      // Flush pending edits if the user navigates away before the debounce fires.
      void (async () => {
        const latest = projectFormRef.current.getValues() as ProjectFormValues;
        const normalized = normalizeProjectValues(latest);
        const last = lastSavedRef.current;
        // The key is excluded on purpose: leaving the page must never rename it (PR-14).
        const hasPendingChanges =
          !last ||
          last.name !== normalized.name ||
          last.description !== normalized.description ||
          last.icon !== normalized.icon;
        if (!hasPendingChanges) return;

        const isValid = await projectFormRef.current.trigger([
          "name",
          "description",
          "icon",
        ]);
        if (isValid) {
          await saveProjectRef.current(latest);
        }
      })();
    };
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!project?.id) return;
    const deleteTrigger = deleteProjectButtonRef.current;
    const finalFocus = () =>
      deleteTrigger?.isConnected ? deleteTrigger : false;

    try {
      // The in-place approval dialog is the single confirmation (PA-3). Deletion is only
      // requested: the project stays (and the user stays on it) until the requester approves.
      const pendingAction = await deleteProject({ id: project.id });
      await openPendingAction({ ...pendingAction, finalFocus });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.toastDeleteError"),
      );
    }
  }, [project?.id, deleteProject, openPendingAction, t]);

  return (
    <>
      <PageTitle title={t("settings:projectGeneral.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:projectGeneral.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:projectGeneral.subtitle")}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-md font-medium">
              {t("settings:projectGeneral.projectInfoTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("settings:projectGeneral.projectInfoSubtitle")}
            </p>
          </div>

          <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings:projectGeneral.iconLabel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectGeneral.iconHint")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Popover
                  open={iconPopoverOpen}
                  onOpenChange={(open) => {
                    setIconPopoverOpen(open);
                    if (!open) setIconSearch("");
                  }}
                  modal={true}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-auto justify-start gap-2 font-normal"
                      title={t("settings:projectGeneral.pickIconTitle")}
                      disabled={!canEdit}
                    >
                      {(() => {
                        const selectedKey =
                          (projectForm.watch("icon") as keyof typeof icons) ||
                          "Layout";
                        const SelectedIcon = icons[selectedKey] || icons.Layout;
                        return <SelectedIcon className="h-4 w-4" />;
                      })()}
                      <span className="truncate text-xs">
                        {projectForm.watch("icon") || "Layout"}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                    <div className="space-y-2">
                      <Input
                        value={iconSearch}
                        onChange={(e) => setIconSearch(e.target.value)}
                        placeholder={t(
                          "settings:projectGeneral.searchIconsPlaceholder",
                        )}
                        className="h-8 text-xs"
                      />
                      <div className="max-h-[280px] overflow-y-auto pr-1">
                        <div className="grid grid-cols-6 gap-1.5">
                          {Object.entries(icons)
                            .filter(([iconName]) =>
                              iconName
                                .toLowerCase()
                                .includes(iconSearch.trim().toLowerCase()),
                            )
                            .map(([iconName, Icon]) => {
                              const isSelected =
                                projectForm.getValues("icon") === iconName;
                              return (
                                <Button
                                  key={iconName}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    projectForm.setValue("icon", iconName, {
                                      shouldDirty: true,
                                      shouldValidate: true,
                                    });
                                    setIconPopoverOpen(false);
                                    setIconSearch("");
                                  }}
                                  className={cn(
                                    "h-10 items-center justify-center rounded-md p-0",
                                    isSelected &&
                                      "bg-sidebar-accent text-sidebar-accent-foreground",
                                  )}
                                  title={iconName}
                                >
                                  <Icon className="h-4 w-4" />
                                </Button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Separator />

            <Form {...projectForm}>
              <form className="space-y-4">
                <FormField
                  control={projectForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:projectGeneral.projectNameLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:projectGeneral.projectNameHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:projectGeneral.projectNamePlaceholder",
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
                  control={projectForm.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:projectGeneral.keyLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:projectGeneral.keyHint", {
                              slug: projectForm.watch("slug") || "ABC",
                            })}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:projectGeneral.keyPlaceholder",
                            )}
                            disabled={!canEdit}
                            {...field}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                      {canEdit && keyChanged && keyProblem === null && (
                        <div
                          className="flex flex-wrap items-center justify-end gap-2"
                          data-testid="project-key-rename"
                        >
                          <p className="text-xs text-muted-foreground">
                            {t("settings:projectGeneral.keyRenamePending")}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setRenameKeyOpen(true)}
                          >
                            {t("settings:projectGeneral.keyRenameAction")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              projectForm.setValue(
                                "slug",
                                project?.slug ?? "",
                                {
                                  shouldValidate: true,
                                },
                              )
                            }
                          >
                            {t("settings:projectGeneral.keyRenameCancel")}
                          </Button>
                        </div>
                      )}
                    </FormItem>
                  )}
                />

                <Separator />

                <FormField
                  control={projectForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-sm font-medium">
                            {t("settings:projectGeneral.descriptionLabel")}
                          </FormLabel>
                          <p className="text-xs text-muted-foreground">
                            {t("settings:projectGeneral.descriptionHint")}
                          </p>
                        </div>
                        <FormControl>
                          <Input
                            className="w-full sm:w-64"
                            placeholder={t(
                              "settings:projectGeneral.descriptionPlaceholder",
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
            {workspace?.id && project?.id && (
              <>
                <Separator />
                <ProjectEngagementSettings
                  projectId={project.id}
                  workspaceId={workspace.id}
                />
              </>
            )}
            {workspace?.id && project?.id && (
              <>
                <Separator />
                <ProjectPlanningSettings
                  projectId={project.id}
                  workspaceId={workspace.id}
                />
              </>
            )}
            {workspace?.id && project?.id && (
              <DefaultCommentVisibilitySetting
                projectId={project.id}
                workspaceId={workspace.id}
              />
            )}
            <Separator />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t("settings:projectGeneral.importExportTasks")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectGeneral.importExportTasksDescription")}
                </p>
              </div>
              {project && <TasksImportExport project={project} />}
            </div>
          </div>
        </div>

        {canDelete && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:projectGeneral.dangerZone")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:projectGeneral.dangerZoneSubtitle")}
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">
                    {t("settings:projectGeneral.deleteProject")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings:projectGeneral.deleteProjectDescription")}
                  </p>
                </div>
                <Button
                  ref={deleteProjectButtonRef}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive transition-colors"
                  type="button"
                  onClick={() => void handleDeleteProject()}
                  disabled={!project || isDeleting}
                >
                  {isDeleting
                    ? t("common:actions.deleting")
                    : t("settings:projectGeneral.deleteProject")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <AlertDialog
        open={renameKeyOpen}
        onOpenChange={(open) => {
          if (!open && !isRenamingKey) setRenameKeyOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectGeneral.keyRenameTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectGeneral.keyRenameDescription", {
                oldKey: persistedKey,
                newKey: pendingKey,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={isRenamingKey}
              onClick={() => setRenameKeyOpen(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              disabled={isRenamingKey}
              onClick={() => void confirmRenameKey()}
            >
              {t("settings:projectGeneral.keyRenameConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
