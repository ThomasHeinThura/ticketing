import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import updateProjectHealth from "@/fetchers/project/update-health";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import {
  buildEngagementPayload,
  classifyEngagementFailure,
  ENGAGEMENT_KINDS,
  type EngagementKind,
  type EngagementSaveFailure,
  HEALTH_VALUES,
  hasEngagementErrors,
  isEngagementDirty,
  isEngagementKind,
  isProjectHealth,
  isSupportLevel,
  type ProjectHealth,
  SUPPORT_LEVELS,
  toEngagementValues,
  validateEngagement,
} from "./project-engagement-form";

const NONE = "none";

function failureOf(error: unknown): EngagementSaveFailure {
  return error instanceof HttpError
    ? classifyEngagementFailure(error.status, error.message)
    : "generic";
}

/**
 * Engagement controls on project settings General: kind, support level, service calendar
 * (PR-9) and RAG health. Both writes need `project:update` server-side (`PUT
 * /api/project/{id}` and `PATCH /api/project/{id}/health`); without it the controls render
 * read-only, and a 403 from the server is still handled. The customer organisation binding
 * is deliberately not here: it is chosen at creation and never changes (#705/#706).
 */
function ProjectEngagementSettings({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useGetProject({ id: projectId, workspaceId });
  const {
    data: calendarPage,
    isLoading: calendarsLoading,
    isError: calendarsError,
    refetch: refetchCalendars,
  } = useServiceCalendars(workspaceId);
  const { mutateAsync: updateProject, isPending: isSaving } =
    useUpdateProject();

  const [draft, setDraft] = useState<ReturnType<
    typeof toEngagementValues
  > | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveFailure, setSaveFailure] = useState<EngagementSaveFailure | null>(
    null,
  );
  const [pendingHealth, setPendingHealth] = useState<
    ProjectHealth | typeof NONE | null
  >(null);
  const [healthFailure, setHealthFailure] =
    useState<EngagementSaveFailure | null>(null);

  const canEdit = canUpdateProjects();

  if (isLoading || (isCheckingPermissions && !project)) {
    return (
      <section
        aria-busy="true"
        aria-label={t("settings:projectGeneral.engagement.title")}
        className="space-y-3"
        data-testid="project-engagement-loading"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </section>
    );
  }

  if (isError || !project) {
    return (
      <section
        aria-labelledby="project-engagement-settings"
        className="space-y-3"
      >
        <h2 id="project-engagement-settings" className="text-sm font-medium">
          {t("settings:projectGeneral.engagement.title")}
        </h2>
        <Alert variant="error" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {t("settings:projectGeneral.engagement.loadError")}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              {t("settings:projectGeneral.engagement.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const saved = toEngagementValues(project);
  const values = draft ?? saved;
  const errors = showErrors ? validateEngagement(values) : {};
  const dirty = isEngagementDirty(saved, values);
  const health: ProjectHealth | typeof NONE =
    pendingHealth ?? (isProjectHealth(project.health) ? project.health : NONE);

  const calendars = calendarPage?.data ?? [];
  const calendarItems = [
    { value: NONE, label: t("settings:projectGeneral.engagement.none") },
    ...calendars.map((calendar) => ({
      value: calendar.id,
      label: calendar.name,
    })),
  ];
  // A saved calendar missing from the loaded page (for example the list failed, or it sits
  // beyond the first page) must still display and survive a save, never be silently dropped.
  if (
    values.serviceCalendarId &&
    !calendarItems.some((item) => item.value === values.serviceCalendarId)
  ) {
    calendarItems.push({
      value: values.serviceCalendarId,
      label: t("settings:projectGeneral.engagement.calendarUnlisted"),
    });
  }

  const kindItems = ENGAGEMENT_KINDS.map((value) => ({
    value,
    label:
      value === "managed_service"
        ? t("settings:projectGeneral.engagement.managedService")
        : t("settings:projectGeneral.engagement.project"),
  }));
  const supportItems = [
    { value: NONE, label: t("settings:projectGeneral.engagement.none") },
    ...SUPPORT_LEVELS.map((value) => ({ value, label: value })),
  ];
  const healthItems = [
    { value: NONE, label: t("settings:projectGeneral.engagement.unset") },
    ...HEALTH_VALUES.map((value) => ({
      value,
      label: t(`settings:projectGeneral.engagement.${value}`),
    })),
  ];

  const invalidateProject = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId, project.id],
      }),
    ]);

  // A 403 means the cached capability map was stale; refresh it so the controls follow.
  const refreshCapabilities = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-capabilities", workspaceId],
    });

  const handleSave = async () => {
    setSaveFailure(null);
    if (hasEngagementErrors(validateEngagement(values))) {
      setShowErrors(true);
      return;
    }
    try {
      await updateProject({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description ?? "",
        icon: project.icon ?? "Layout",
        ...buildEngagementPayload(values),
      });
      await invalidateProject();
      setDraft(null);
      setShowErrors(false);
      toast.success(t("settings:projectGeneral.engagement.saved"));
    } catch (error) {
      const failure = failureOf(error);
      setSaveFailure(failure);
      if (failure === "forbidden") void refreshCapabilities();
    }
  };

  const handleHealth = async (value: unknown) => {
    if (typeof value !== "string" || value === health) return;
    if (value !== NONE && !isProjectHealth(value)) return;
    setHealthFailure(null);
    setPendingHealth(value);
    try {
      await updateProjectHealth(project.id, value === NONE ? null : value);
      await invalidateProject();
    } catch (error) {
      const failure = failureOf(error);
      setHealthFailure(failure);
      if (failure === "forbidden") void refreshCapabilities();
    } finally {
      setPendingHealth(null);
    }
  };

  const setKind = (value: unknown) => {
    if (!isEngagementKind(value)) return;
    setDraft({ ...values, kind: value as EngagementKind });
  };

  const failureMessage = (failure: EngagementSaveFailure) =>
    t(`settings:projectGeneral.engagement.failure.${failure}`);

  return (
    <section
      className="space-y-4"
      aria-labelledby="project-engagement-settings"
      data-testid="project-engagement"
    >
      <div className="space-y-1">
        <h2 id="project-engagement-settings" className="text-sm font-medium">
          {t("settings:projectGeneral.engagement.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings:projectGeneral.engagement.description")}
        </p>
      </div>

      {!canEdit && (
        <Alert variant="info" data-testid="project-engagement-readonly">
          <AlertDescription>
            {t("settings:projectGeneral.engagement.readOnly")}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="project-engagement-kind"
            className="text-sm font-medium"
          >
            {t("settings:projectGeneral.engagement.kind")}
          </label>
          <Select
            items={kindItems}
            value={values.kind}
            disabled={!canEdit || isSaving}
            onValueChange={setKind}
          >
            <SelectTrigger id="project-engagement-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="project-engagement-health"
            className="text-sm font-medium"
          >
            {t("settings:projectGeneral.engagement.health")}
          </label>
          <Select
            items={healthItems}
            value={health}
            disabled={!canEdit || pendingHealth !== null}
            onValueChange={handleHealth}
          >
            <SelectTrigger id="project-engagement-health" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {healthItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {healthFailure && (
            <p
              role="alert"
              className="text-xs text-destructive"
              data-testid="project-engagement-health-error"
            >
              {failureMessage(healthFailure)}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="project-engagement-support-level"
            className="text-sm font-medium"
          >
            {t("settings:projectGeneral.engagement.supportLevel")}
          </label>
          <Select
            items={supportItems}
            value={values.supportLevel ?? NONE}
            disabled={!canEdit || isSaving}
            onValueChange={(value) =>
              setDraft({
                ...values,
                supportLevel: isSupportLevel(value) ? value : null,
              })
            }
          >
            <SelectTrigger
              id="project-engagement-support-level"
              className="w-full"
              aria-invalid={errors.supportLevel ? true : undefined}
              aria-describedby={
                errors.supportLevel
                  ? "project-engagement-support-level-error"
                  : undefined
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.supportLevel && (
            <p
              id="project-engagement-support-level-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {t("settings:projectGeneral.engagement.supportLevelRequired")}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="project-engagement-calendar"
            className="text-sm font-medium"
          >
            {t("settings:projectGeneral.engagement.serviceCalendar")}
          </label>
          <Select
            items={calendarItems}
            value={values.serviceCalendarId ?? NONE}
            disabled={!canEdit || isSaving || calendarsLoading}
            onValueChange={(value) =>
              setDraft({
                ...values,
                serviceCalendarId:
                  typeof value === "string" && value !== NONE ? value : null,
              })
            }
          >
            <SelectTrigger
              id="project-engagement-calendar"
              className="w-full"
              aria-invalid={errors.serviceCalendarId ? true : undefined}
              aria-describedby={
                errors.serviceCalendarId
                  ? "project-engagement-calendar-error"
                  : undefined
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {calendarItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.serviceCalendarId && (
            <p
              id="project-engagement-calendar-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {t("settings:projectGeneral.engagement.calendarRequired")}
            </p>
          )}
          {!calendarsLoading && !calendarsError && calendars.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings:projectGeneral.engagement.noCalendars")}
            </p>
          )}
          {calendarsError && (
            <p
              role="alert"
              className="flex items-center gap-2 text-xs text-destructive"
            >
              {t("settings:projectGeneral.engagement.calendarsError")}
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void refetchCalendars()}
              >
                {t("settings:projectGeneral.engagement.retry")}
              </Button>
            </p>
          )}
        </div>
      </div>

      {saveFailure && (
        <Alert variant="error" role="alert">
          <AlertDescription>{failureMessage(saveFailure)}</AlertDescription>
        </Alert>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving
              ? t("settings:projectGeneral.engagement.saving")
              : t("settings:projectGeneral.engagement.save")}
          </Button>
          {dirty && !isSaving && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null);
                setShowErrors(false);
                setSaveFailure(null);
              }}
            >
              {t("settings:projectGeneral.engagement.discard")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export default ProjectEngagementSettings;
