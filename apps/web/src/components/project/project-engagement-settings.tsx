import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import updateProjectHealth from "@/fetchers/project/update-health";
import {
  getProjectSettingsInheritance,
  patchProjectSettingsInheritance,
  WorkspaceSettingsError,
} from "@/fetchers/project-settings-inheritance";
import { getServiceCalendars } from "@/fetchers/service-calendar";
import { getSlaPolicies } from "@/fetchers/sla-policy";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useGetProject from "@/hooks/queries/project/use-get-project";
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
const INHERIT = "__inherit__";
const OVERRIDE_NONE = "__override_none__";

async function listAllPages<T extends { page: { nextCursor: string | null } }>(
  load: (cursor?: string) => Promise<T>,
): Promise<T[]> {
  const pages: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await load(cursor);
    pages.push(page);
    const next = page.page.nextCursor;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return pages;
}

function failureOf(error: unknown): EngagementSaveFailure {
  return error instanceof HttpError
    ? classifyEngagementFailure(error.status, error.message)
    : "generic";
}

/**
 * Engagement controls on project settings General: kind, support level and RAG health. SLA
 * and calendar inheritance are saved separately through the settings-inheritance API. Both
 * writes need their own strict server-side capabilities; without them the controls render
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
  const { canUpdateProjects, canManageProjectSettings, isCheckingPermissions } =
    useWorkspacePermission();
  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useGetProject({ id: projectId, workspaceId });
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

  // Health stays on `project:update`. Kind, support level and service calendar need the strict
  // `project:manage_settings` as well (PUT /api/project/{id}, #766); the server decides, this
  // only chooses which controls are offered.
  const canEditHealth = canUpdateProjects();
  const canEditEngagement = canEditHealth && canManageProjectSettings();

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
      if (failure === "forbidden") {
        // The capability map was stale: drop the unsaved edit so the controls show what is
        // saved, and refresh capabilities so they follow what the server allows now.
        setDraft(null);
        setShowErrors(false);
        void refreshCapabilities();
      }
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

      {!canEditHealth && (
        <Alert variant="info" data-testid="project-engagement-readonly">
          <AlertDescription>
            {t("settings:projectGeneral.engagement.readOnly")}
          </AlertDescription>
        </Alert>
      )}
      {canEditHealth && !canEditEngagement && (
        <Alert
          variant="info"
          data-testid="project-engagement-settings-readonly"
        >
          <AlertDescription>
            {t("settings:projectGeneral.engagement.manageSettingsRequired")}
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
            disabled={!canEditEngagement || isSaving}
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
            disabled={!canEditHealth || pendingHealth !== null}
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
            disabled={!canEditEngagement || isSaving}
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
      </div>

      <ProjectInheritanceSettings
        projectId={project.id}
        workspaceId={workspaceId}
        canEdit={canEditEngagement}
      />

      {saveFailure && (
        <Alert variant="error" role="alert">
          <AlertDescription>{failureMessage(saveFailure)}</AlertDescription>
        </Alert>
      )}

      {canEditEngagement && (
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

function ProjectInheritanceSettings({
  projectId,
  workspaceId,
  canEdit,
}: {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["projects", projectId, "settings-inheritance"] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => getProjectSettingsInheritance(projectId),
    enabled: Boolean(projectId),
  });
  const slaQuery = useQuery({
    queryKey: ["sla-policies", workspaceId, "project-inheritance-options"],
    queryFn: async () =>
      (
        await listAllPages((cursor) => getSlaPolicies(workspaceId, cursor))
      ).flatMap((page) => page.data),
    enabled: Boolean(workspaceId),
  });
  const calendarQuery = useQuery({
    queryKey: ["service-calendars", workspaceId, "project-inheritance-options"],
    queryFn: async () =>
      (
        await listAllPages((cursor) => getServiceCalendars(workspaceId, cursor))
      ).flatMap((page) => page.data),
    enabled: Boolean(workspaceId),
  });
  const [slaChoice, setSlaChoice] = useState(INHERIT);
  const [calendarChoice, setCalendarChoice] = useState(INHERIT);
  const [baseVersions, setBaseVersions] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<
    "stale" | "forbidden" | "generic" | null
  >(null);

  const current = query.data;
  const versionKey = current
    ? `${projectId}:${current.projectVersion}:${current.workspaceVersion}`
    : "";
  useEffect(() => {
    if (!current || baseVersions === versionKey) return;
    setSlaChoice(
      current.slaPolicy.mode === "inherit"
        ? INHERIT
        : (current.slaPolicy.overrideId ?? OVERRIDE_NONE),
    );
    setCalendarChoice(
      current.serviceCalendar.mode === "inherit"
        ? INHERIT
        : (current.serviceCalendar.overrideId ?? OVERRIDE_NONE),
    );
    setBaseVersions(versionKey);
    setFailure(null);
  }, [baseVersions, current, versionKey]);
  useEffect(() => {
    const errors = [query.error, slaQuery.error, calendarQuery.error];
    if (
      errors.some((error) => error instanceof HttpError && error.status === 403)
    ) {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", workspaceId],
      });
    }
  }, [
    query.error,
    slaQuery.error,
    calendarQuery.error,
    queryClient,
    workspaceId,
  ]);

  if (query.isLoading || slaQuery.isLoading || calendarQuery.isLoading) {
    return (
      <div
        className="space-y-2"
        aria-busy="true"
        data-testid="project-inheritance-loading"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (query.isError || !current || slaQuery.isError || calendarQuery.isError) {
    const forbidden = [query.error, slaQuery.error, calendarQuery.error].some(
      (error) => error instanceof HttpError && error.status === 403,
    );
    return (
      <Alert variant="error" role="alert">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          {t(
            forbidden
              ? "settings:projectInheritance.forbidden"
              : "settings:projectInheritance.loadError",
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void Promise.all([
                query.refetch(),
                slaQuery.refetch(),
                calendarQuery.refetch(),
              ])
            }
          >
            {t("settings:projectInheritance.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const slaOptions = slaQuery.data ?? [];
  const calendarOptions = calendarQuery.data ?? [];
  const choicesFor = (
    value: typeof current.slaPolicy,
    options: Array<{ id: string; name: string }>,
  ) => {
    const items = options.map((option) => ({
      value: option.id,
      label: option.name,
    }));
    if (
      value.overrideId &&
      !items.some((item) => item.value === value.overrideId)
    ) {
      items.push({
        value: value.overrideId,
        label: t("settings:projectInheritance.unlisted"),
      });
    }
    return items;
  };
  const slaItems = choicesFor(current.slaPolicy, slaOptions);
  const calendarItems = choicesFor(current.serviceCalendar, calendarOptions);
  const choiceFor = (choice: string, inheritedValue: string | null) => {
    if (choice === INHERIT) {
      return t("settings:projectInheritance.inheritedFromWorkspace", {
        value: inheritedValue ?? t("settings:projectInheritance.none"),
      });
    }
    return choice === OVERRIDE_NONE
      ? t("settings:projectInheritance.none")
      : undefined;
  };
  const isDirty =
    (slaChoice === INHERIT
      ? current.slaPolicy.mode !== "inherit"
      : current.slaPolicy.mode !== "override" ||
        (slaChoice === OVERRIDE_NONE ? null : slaChoice) !==
          current.slaPolicy.overrideId) ||
    (calendarChoice === INHERIT
      ? current.serviceCalendar.mode !== "inherit"
      : current.serviceCalendar.mode !== "override" ||
        (calendarChoice === OVERRIDE_NONE ? null : calendarChoice) !==
          current.serviceCalendar.overrideId);
  const save = async () => {
    if (!isDirty || saving || !canEdit) return;
    setSaving(true);
    setFailure(null);
    try {
      const result = await patchProjectSettingsInheritance(projectId, {
        expectedProjectVersion: current.projectVersion,
        expectedWorkspaceVersion: current.workspaceVersion,
        ...(slaChoice !==
        (current.slaPolicy.mode === "inherit"
          ? INHERIT
          : (current.slaPolicy.overrideId ?? OVERRIDE_NONE))
          ? {
              slaPolicy:
                slaChoice === INHERIT
                  ? { mode: "inherit" as const }
                  : {
                      mode: "override" as const,
                      id: slaChoice === OVERRIDE_NONE ? null : slaChoice,
                    },
            }
          : {}),
        ...(calendarChoice !==
        (current.serviceCalendar.mode === "inherit"
          ? INHERIT
          : (current.serviceCalendar.overrideId ?? OVERRIDE_NONE))
          ? {
              serviceCalendar:
                calendarChoice === INHERIT
                  ? { mode: "inherit" as const }
                  : {
                      mode: "override" as const,
                      id:
                        calendarChoice === OVERRIDE_NONE
                          ? null
                          : calendarChoice,
                    },
            }
          : {}),
      });
      queryClient.setQueryData(queryKey, result);
      await queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId, projectId],
      });
      setBaseVersions(
        `${projectId}:${result.projectVersion}:${result.workspaceVersion}`,
      );
    } catch (error) {
      setFailure(
        error instanceof WorkspaceSettingsError && error.status === 409
          ? "stale"
          : error instanceof WorkspaceSettingsError && error.status === 403
            ? "forbidden"
            : "generic",
      );
      if (error instanceof WorkspaceSettingsError && error.status === 409)
        void query.refetch();
      if (error instanceof WorkspaceSettingsError && error.status === 403)
        void queryClient.invalidateQueries({
          queryKey: ["workspace-capabilities", workspaceId],
        });
    } finally {
      setSaving(false);
    }
  };
  const selector = (
    id: string,
    label: string,
    choice: string,
    setChoice: (value: string) => void,
    inherited: string | null,
    options: Array<{ value: string; label: string }>,
  ) => {
    const items = [
      { value: INHERIT, label: choiceFor(INHERIT, inherited) ?? "" },
      { value: OVERRIDE_NONE, label: choiceFor(OVERRIDE_NONE, null) ?? "" },
      ...options,
    ];
    return (
      <div className="space-y-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <Select
          items={items}
          value={choice}
          disabled={!canEdit || saving}
          onValueChange={(value) => {
            if (typeof value === "string") setChoice(value);
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue>
              {choiceFor(choice, inherited) ??
                items.find((item) => item.value === choice)?.label}
            </SelectValue>
            <span className="text-xs text-muted-foreground">
              {t(
                choice === INHERIT
                  ? "settings:projectInheritance.override"
                  : "settings:projectInheritance.useWorkspace",
              )}
            </span>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };
  return (
    <div
      className="space-y-4 rounded-md border border-border bg-sidebar p-4"
      data-testid="project-settings-inheritance"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {t("settings:projectInheritance.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settings:projectInheritance.description")}
        </p>
      </div>
      {selector(
        "project-inherited-sla",
        t("settings:projectInheritance.slaPolicy"),
        slaChoice,
        setSlaChoice,
        current.slaPolicy.effectiveName,
        slaItems,
      )}
      {selector(
        "project-inherited-calendar",
        t("settings:projectInheritance.serviceCalendar"),
        calendarChoice,
        setCalendarChoice,
        current.serviceCalendar.effectiveName,
        calendarItems,
      )}
      <div className="text-xs text-muted-foreground">
        {t("settings:projectInheritance.effectiveSla", {
          value:
            current.slaPolicy.effectiveName ??
            t("settings:projectInheritance.none"),
          source: t(
            `settings:projectInheritance.source.${current.slaPolicy.source}`,
          ),
        })}
        <br />
        {t("settings:projectInheritance.effectiveCalendar", {
          value:
            current.serviceCalendar.effectiveName ??
            t("settings:projectInheritance.none"),
          source: t(
            `settings:projectInheritance.source.${current.serviceCalendar.source}`,
          ),
        })}
      </div>
      {failure && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t(`settings:projectInheritance.${failure}`)}
          </AlertDescription>
        </Alert>
      )}
      {canEdit && (
        <Button
          type="button"
          size="sm"
          disabled={!isDirty || saving}
          onClick={() => void save()}
        >
          {saving
            ? t("settings:projectInheritance.saving")
            : t("settings:projectInheritance.save")}
        </Button>
      )}
    </div>
  );
}

export default ProjectEngagementSettings;
