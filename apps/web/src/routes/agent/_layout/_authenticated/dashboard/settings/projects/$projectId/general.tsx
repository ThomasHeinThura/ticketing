import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogClose,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@taskdesk/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import PageTitle from "@/components/page-title";
import { TasksImportExport } from "@/components/project/tasks-import-export.tsx";
import icons from "@/constants/project-icons";
import { updateProjectHealth } from "@/fetchers/project/update-health";
import useDeleteProject from "@/hooks/mutations/project/use-delete-project";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
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
  const projectSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("settings:projectGeneral.validation.nameRequired")),
        slug: z
          .string()
          .trim()
          .min(1, t("settings:projectGeneral.validation.keyRequired"))
          .max(8, t("settings:projectGeneral.validation.keyMax")),
        description: z.string().optional(),
        icon: z
          .string()
          .min(1, t("settings:projectGeneral.validation.iconRequired")),
      }),
    [t],
  );

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const queuedSaveRef = useRef<ProjectFormValues | null>(null);
  const lastSavedRef = useRef<NormalizedProjectValues | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [iconPopoverOpen, setIconPopoverOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");

  const { data: workspace } = useActiveWorkspace();
  const { data: calendarPage } = useServiceCalendars(workspace?.id ?? "");
  const { projectId: rawProjectId } = useParams({ strict: false });
  const projectId = rawProjectId ?? "";
  const { data: fetchedProject } = useGetTasks(projectId);
  const { data: projectDetails } = useGetProject({
    id: projectId,
    workspaceId: workspace?.id ?? "",
  });
  const { project, setProject } = useProjectStore();
  const [engagementKind, setEngagementKind] = useState<
    "project" | "managed_service"
  >("project");
  const [supportLevel, setSupportLevel] = useState<"L1" | "L2" | "L3" | "">("");
  const [serviceCalendarId, setServiceCalendarId] = useState("");
  const [health, setHealth] = useState<"red" | "amber" | "green" | "unset">(
    "unset",
  );
  const [engagementError, setEngagementError] = useState<string | null>(null);
  const [isSavingEngagement, setIsSavingEngagement] = useState(false);
  const [isSavingHealth, setIsSavingHealth] = useState(false);

  useEffect(() => {
    if (fetchedProject) {
      setProject(fetchedProject);
    }
  }, [fetchedProject, setProject]);

  useEffect(() => {
    if (!projectDetails) return;
    setEngagementKind(projectDetails.kind as "project" | "managed_service");
    setSupportLevel(
      (projectDetails.supportLevel as "L1" | "L2" | "L3" | "") ?? "",
    );
    setServiceCalendarId(projectDetails.serviceCalendarId ?? "");
    setHealth(
      (projectDetails.health as "red" | "amber" | "green" | null) ?? "unset",
    );
  }, [projectDetails]);

  const { mutateAsync: updateProject } = useUpdateProject();
  const { mutateAsync: deleteProject, isPending: isDeleting } =
    useDeleteProject();
  const { canManageProjects, canDeleteProjects } = useWorkspacePermission();
  const canEdit = canManageProjects();
  const canDelete = canDeleteProjects();

  const saveEngagement = useCallback(async () => {
    if (!project?.id) return;
    if (
      engagementKind === "managed_service" &&
      (!supportLevel || !serviceCalendarId)
    ) {
      setEngagementError(t("settings:projectGeneral.engagement.required"));
      return;
    }
    setEngagementError(null);
    setIsSavingEngagement(true);
    try {
      await updateProject({
        id: project.id,
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        kind: engagementKind,
        supportLevel: supportLevel || null,
        serviceCalendarId: serviceCalendarId || null,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({
          queryKey: ["projects", workspace?.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects", workspace?.id, project.id],
        }),
      ]);
      toast.success(t("settings:projectGeneral.engagement.saved"));
    } catch (error) {
      setEngagementError(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.engagement.saveError"),
      );
    } finally {
      setIsSavingEngagement(false);
    }
  }, [
    project,
    engagementKind,
    supportLevel,
    serviceCalendarId,
    updateProject,
    queryClient,
    workspace?.id,
    t,
  ]);

  const saveHealth = useCallback(
    async (value: "red" | "amber" | "green" | "unset") => {
      if (!project?.id) return;
      const previousHealth = health;
      setHealth(value);
      setIsSavingHealth(true);
      try {
        await updateProjectHealth(project.id, value === "unset" ? null : value);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["projects"] }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspace?.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["projects", workspace?.id, project.id],
          }),
        ]);
      } catch (error) {
        setHealth(previousHealth);
        setEngagementError(
          error instanceof Error
            ? error.message
            : t("settings:projectGeneral.engagement.saveError"),
        );
      } finally {
        setIsSavingHealth(false);
      }
    },
    [project?.id, health, queryClient, workspace?.id, t],
  );

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

  const saveProject = useCallback(
    async (data: ProjectFormValues) => {
      if (!project?.id) return;

      const normalizedData = normalizeProjectValues(data);
      const nameChanged = lastSavedRef.current?.name !== normalizedData.name;
      const slugChanged = lastSavedRef.current?.slug !== normalizedData.slug;
      const descriptionChanged =
        lastSavedRef.current?.description !== normalizedData.description;
      const iconChanged = lastSavedRef.current?.icon !== normalizedData.icon;
      const hasChanges =
        nameChanged || slugChanged || descriptionChanged || iconChanged;

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
          slug: slugChanged ? normalizedData.slug : project.slug,
          description: descriptionChanged
            ? normalizedData.description
            : (project.description ?? ""),
          icon: iconChanged ? normalizedData.icon : (project.icon ?? "Layout"),
        };

        await updateProject(updatePayload);

        projectForm.reset(normalizedData, { keepDirty: false });
        lastSavedRef.current = normalizedData;
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

  const saveProjectRef = useRef(saveProject);
  const projectFormRef = useRef(projectForm);
  saveProjectRef.current = saveProject;
  projectFormRef.current = projectForm;

  const debouncedSave = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      const isValid = await projectForm.trigger();
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
        const hasPendingChanges =
          !last ||
          last.name !== normalized.name ||
          last.slug !== normalized.slug ||
          last.description !== normalized.description ||
          last.icon !== normalized.icon;
        if (!hasPendingChanges) return;

        const isValid = await projectFormRef.current.trigger();
        if (isValid) {
          await saveProjectRef.current(latest);
        }
      })();
    };
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!project?.id) return;

    try {
      await deleteProject({ id: project.id });
      toast.success(t("settings:projectGeneral.toastDeleted"));

      await queryClient.invalidateQueries({ queryKey: ["projects"] });

      navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: workspace?.id || "" },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectGeneral.toastDeleteError"),
      );
    }
  }, [project?.id, deleteProject, queryClient, navigate, workspace?.id, t]);

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
            <Separator />
            <section
              className="space-y-4"
              aria-labelledby="project-engagement-settings"
            >
              <div className="space-y-1">
                <h2
                  id="project-engagement-settings"
                  className="text-sm font-medium"
                >
                  {t("settings:projectGeneral.engagement.title")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectGeneral.engagement.description")}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <span>{t("settings:projectGeneral.engagement.kind")}</span>
                  <Select
                    value={engagementKind}
                    onValueChange={(value) =>
                      value &&
                      setEngagementKind(value as "project" | "managed_service")
                    }
                  >
                    <SelectTrigger
                      aria-label={t("settings:projectGeneral.engagement.kind")}
                      className="w-full"
                      disabled={!canEdit}
                    >
                      <SelectValue>
                        {engagementKind === "managed_service"
                          ? t(
                              "settings:projectGeneral.engagement.managedService",
                            )
                          : t("settings:projectGeneral.engagement.project")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">
                        {t("settings:projectGeneral.engagement.project")}
                      </SelectItem>
                      <SelectItem value="managed_service">
                        {t("settings:projectGeneral.engagement.managedService")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 text-sm">
                  <span>{t("settings:projectGeneral.engagement.health")}</span>
                  <Select
                    value={health}
                    disabled={!canEdit || isSavingHealth}
                    onValueChange={(value) =>
                      value &&
                      void saveHealth(
                        value as "red" | "amber" | "green" | "unset",
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={t(
                        "settings:projectGeneral.engagement.health",
                      )}
                      className="w-full"
                    >
                      <SelectValue>
                        {t(`settings:projectGeneral.engagement.${health}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">
                        {t("settings:projectGeneral.engagement.unset")}
                      </SelectItem>
                      <SelectItem value="red">
                        {t("settings:projectGeneral.engagement.red")}
                      </SelectItem>
                      <SelectItem value="amber">
                        {t("settings:projectGeneral.engagement.amber")}
                      </SelectItem>
                      <SelectItem value="green">
                        {t("settings:projectGeneral.engagement.green")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 text-sm">
                  <span>
                    {t("settings:projectGeneral.engagement.supportLevel")}
                  </span>
                  <Select
                    value={supportLevel || "none"}
                    disabled={!canEdit}
                    onValueChange={(value) =>
                      value &&
                      setSupportLevel(
                        value === "none" ? "" : (value as "L1" | "L2" | "L3"),
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={t(
                        "settings:projectGeneral.engagement.supportLevel",
                      )}
                      className="w-full"
                    >
                      <SelectValue>
                        {supportLevel ||
                          t("settings:projectGeneral.engagement.none")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t("settings:projectGeneral.engagement.none")}
                      </SelectItem>
                      <SelectItem value="L1">L1</SelectItem>
                      <SelectItem value="L2">L2</SelectItem>
                      <SelectItem value="L3">L3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 text-sm">
                  <span>
                    {t("settings:projectGeneral.engagement.serviceCalendar")}
                  </span>
                  <Select
                    value={serviceCalendarId || "none"}
                    disabled={!canEdit || !calendarPage}
                    onValueChange={(value) =>
                      value &&
                      setServiceCalendarId(value === "none" ? "" : value)
                    }
                  >
                    <SelectTrigger
                      aria-label={t(
                        "settings:projectGeneral.engagement.serviceCalendar",
                      )}
                      className="w-full"
                    >
                      <SelectValue
                        placeholder={t(
                          "settings:projectGeneral.engagement.selectCalendar",
                        )}
                      >
                        {calendarPage?.data.find(
                          (calendar) => calendar.id === serviceCalendarId,
                        )?.name ?? t("settings:projectGeneral.engagement.none")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t("settings:projectGeneral.engagement.none")}
                      </SelectItem>
                      {calendarPage?.data.map((calendar) => (
                        <SelectItem key={calendar.id} value={calendar.id}>
                          {calendar.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {engagementError ? (
                <p role="alert" className="text-sm text-destructive">
                  {engagementError}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={!canEdit || isSavingEngagement}
                onClick={() => void saveEngagement()}
              >
                {isSavingEngagement
                  ? t("settings:projectGeneral.engagement.saving")
                  : t("settings:projectGeneral.engagement.save")}
              </Button>
            </section>
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
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive transition-colors"
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  disabled={!project}
                >
                  {t("settings:projectGeneral.deleteProject")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <AlertDialog
          open={isDeleteModalOpen}
          onOpenChange={setIsDeleteModalOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings:projectGeneral.deleteModalTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings:projectGeneral.deleteModalDescription", {
                  name: project?.name ?? "",
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
                    onClick={handleDeleteProject}
                  />
                }
              >
                {isDeleting
                  ? t("common:actions.deleting")
                  : t("settings:projectGeneral.deleteModalConfirm")}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
