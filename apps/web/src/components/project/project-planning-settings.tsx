import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  Button,
  Calendar,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
} from "@taskdesk/ui";
import { CalendarDays, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useUpdateProjectOwnership from "@/hooks/mutations/project/use-update-project-ownership";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetAssignablePeople from "@/hooks/queries/work-item/use-get-assignable-people";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateMedium } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { isoToDay } from "@/lib/work-item-date";
import { useUserPreferencesStore } from "@/store/user-preferences";
import ReparentPreviewDialog from "./members/reparent-preview-dialog";
import {
  buildPlanningPayload,
  classifyOwnershipFailure,
  classifyPlanningFailure,
  dayToDateString,
  isCompositionWarning,
  type OwnershipFailure,
  type PlanningSaveFailure,
  type PlanningValues,
  selectableParents,
  toPlanningValues,
  validatePlanning,
} from "./project-planning-form";

const NONE = "none";
/** The General page's own setting row: label and hint on the left, the control on the right. */
const ROW =
  "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4";

type DateFieldProps = {
  id: string;
  value: string | null;
  disabled: boolean;
  placeholder: string;
  clearLabel: string;
  bound?: { before: Date } | { after: Date };
  invalid?: boolean;
  onChange: (value: string | null) => void;
};

/** The Kaneo date control: a ghost Button opening a Popover with the library Calendar, the
 * same composition the work item detail uses for start and due dates. */
function DateField({
  id,
  value,
  disabled,
  placeholder,
  clearLabel,
  bound,
  invalid,
  onChange,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const day = isoToDay(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          className="w-full justify-start gap-2 font-normal"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className={value ? undefined : "text-muted-foreground"}>
            {day ? formatDateMedium(day) : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={day}
          onSelect={(next) => {
            onChange(dayToDateString(next));
            setOpen(false);
          }}
          disabled={bound}
          className="w-full bg-popover"
          weekStartsOn={weekStartsOn}
        />
        {value ? (
          <div className="border-border border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="h-4 w-4" />
              {clearLabel}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Planning and ownership controls on project settings General: parent project (PR-1), project
 * manager (PR-6), start and end date (PR-10) and default assignee (AS-11), plus the
 * warning-only composition rules (PR-6, PR-7, PR-10) as a persistent banner.
 *
 * One save model, Kaneo's: every control saves as soon as it changes (the page autosaves its
 * name, description and icon the same way), in the page's own label-and-hint rows. Manager,
 * dates and default assignee save through `PUT /api/project/{id}` and need the strict
 * `project:manage_settings`. The parent saves through `PATCH /api/projects/{id}/ownership`,
 * which needs `project:manage_members` on both projects; the controls are offered to anyone who
 * can update the project and the server's 403 is handled. People come from the project's
 * assignable list, which the server already filters for the caller.
 */
function ProjectPlanningSettings({
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
  const { data: projects } = useGetProjects({ workspaceId });
  const { data: people, isLoading: peopleLoading } = useGetAssignablePeople({
    projectId,
    enabled: true,
  });
  const { mutateAsync: updateProject, isPending: isSaving } =
    useUpdateProject();
  const { mutateAsync: updateOwnership, isPending: isMoving } =
    useUpdateProjectOwnership();

  const [draft, setDraft] = useState<PlanningValues | null>(null);
  const [saveFailure, setSaveFailure] = useState<PlanningSaveFailure | null>(
    null,
  );
  const [ownershipFailure, setOwnershipFailure] =
    useState<OwnershipFailure | null>(null);
  // The prospective parent awaiting confirmation: undefined = no move pending, null = top level.
  const [pendingParentId, setPendingParentId] = useState<
    string | null | undefined
  >(undefined);

  const canEditPlanning = canUpdateProjects() && canManageProjectSettings();
  const canEditParent = canUpdateProjects();

  if (isLoading || (isCheckingPermissions && !project)) {
    return (
      <section
        aria-busy="true"
        aria-label={t("settings:projectGeneral.planning.title")}
        className="space-y-3"
        data-testid="project-planning-loading"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </section>
    );
  }

  if (isError || !project) {
    return (
      <section className="space-y-3" aria-labelledby="project-planning-title">
        <h2 id="project-planning-title" className="text-sm font-medium">
          {t("settings:projectGeneral.planning.title")}
        </h2>
        <Alert variant="error" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {t("settings:projectGeneral.planning.loadError")}
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

  const saved = toPlanningValues(project);
  const values = draft ?? saved;
  const errors = validatePlanning(values);
  const warnings = (project.compositionWarnings ?? []).filter(
    isCompositionWarning,
  );

  const personItems = (selected: string | null) => {
    const items = [
      { value: NONE, label: t("settings:projectGeneral.planning.none") },
      ...(people ?? []).map((person) => ({
        value: person.personId,
        label: person.name ?? person.personId,
      })),
    ];
    // A saved person missing from the roster list (left the project, or deactivated) must
    // still display and survive a save, never be silently dropped (AS-8's reasoning).
    if (selected && !items.some((item) => item.value === selected)) {
      items.push({
        value: selected,
        label: t("settings:projectGeneral.planning.personUnlisted"),
      });
    }
    return items;
  };
  const managerItems = personItems(values.managerId);
  const assigneeItems = personItems(values.defaultAssigneeId);

  const parentCandidates = selectableParents(projects ?? [], project.id);
  const parentItems = [
    { value: NONE, label: t("settings:projectGeneral.planning.noParent") },
    ...parentCandidates.map((candidate) => ({
      value: candidate.id,
      label: candidate.name,
    })),
  ];
  const currentParentId = project.parentId ?? null;
  if (
    currentParentId &&
    !parentItems.some((item) => item.value === currentParentId)
  ) {
    parentItems.push({
      value: currentParentId,
      label: t("settings:projectGeneral.planning.parentUnlisted"),
    });
  }

  const invalidateProject = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId, project.id],
      }),
    ]);

  const refreshCapabilities = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-capabilities", workspaceId],
    });

  /** Saves one changed field straight away. An invalid combination is held back and shown. */
  const commit = async (patch: Partial<PlanningValues>) => {
    if (isSaving) return;
    setSaveFailure(null);
    const next = { ...values, ...patch };
    if (Object.keys(validatePlanning(next)).length > 0) {
      setDraft(next);
      return;
    }
    try {
      await updateProject({
        id: project.id,
        name: project.name,
        slug: project.slug,
        description: project.description ?? "",
        icon: project.icon ?? "Layout",
        ...buildPlanningPayload(saved, next),
      });
      await invalidateProject();
      setDraft(null);
      toast.success(t("settings:projectGeneral.planning.saved"));
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? classifyPlanningFailure(error.status, error.message)
          : "generic";
      setSaveFailure(failure);
      setDraft(null);
      if (failure === "forbidden") void refreshCapabilities();
    }
  };

  const handleParent = async (value: unknown) => {
    if (typeof value !== "string") return;
    const next = value === NONE ? null : value;
    if (next === currentParentId) return;
    setOwnershipFailure(null);
    // A re-parent changes who can reach the project, so it is previewed and confirmed first.
    setPendingParentId(next);
  };

  const confirmParent = async () => {
    if (pendingParentId === undefined) return;
    const next = pendingParentId;
    try {
      await updateOwnership({ projectId: project.id, parentId: next });
      setPendingParentId(undefined);
      await invalidateProject();
      toast.success(t("settings:projectGeneral.planning.parentSaved"));
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? classifyOwnershipFailure(error.status, error.message)
          : "generic";
      setOwnershipFailure(failure);
      setPendingParentId(undefined);
      if (failure === "forbidden") void refreshCapabilities();
    }
  };

  const startDay = isoToDay(values.startDate);
  const endDay = isoToDay(values.endDate);

  return (
    <section
      className="space-y-4"
      aria-labelledby="project-planning-title"
      data-testid="project-planning"
    >
      <div className="space-y-1">
        <h2 id="project-planning-title" className="text-sm font-medium">
          {t("settings:projectGeneral.planning.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings:projectGeneral.planning.description")}
        </p>
      </div>

      {warnings.length > 0 && (
        <Alert variant="warning" data-testid="project-composition-warnings">
          <TriangleAlert />
          <AlertDescription>
            <p className="text-xs font-medium">
              {t("settings:projectGeneral.planning.warningsTitle")}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {warnings.map((warning) => (
                <li key={warning}>
                  {t(`settings:projectGeneral.planning.warnings.${warning}`)}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {!canEditPlanning && (
        <Alert variant="info" data-testid="project-planning-readonly">
          <AlertDescription>
            {t("settings:projectGeneral.planning.readOnly")}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className={ROW}>
          <div className="space-y-0.5">
            <Label htmlFor="project-planning-parent" className="font-medium">
              {t("settings:projectGeneral.planning.parent")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings:projectGeneral.planning.parentHint")}
            </p>
            {ownershipFailure && (
              <p
                role="alert"
                className="text-xs text-destructive"
                data-testid="project-planning-parent-error"
              >
                {t(
                  `settings:projectGeneral.planning.ownershipFailure.${ownershipFailure}`,
                )}
              </p>
            )}
          </div>
          <Select
            items={parentItems}
            value={currentParentId ?? NONE}
            disabled={!canEditParent || isMoving}
            onValueChange={(value) => void handleParent(value)}
          >
            <SelectTrigger
              id="project-planning-parent"
              className="w-full sm:w-64"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {parentItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className={ROW}>
          <Label htmlFor="project-planning-manager" className="font-medium">
            {t("settings:projectGeneral.planning.manager")}
          </Label>
          <Select
            items={managerItems}
            value={values.managerId ?? NONE}
            disabled={!canEditPlanning || isSaving || peopleLoading}
            onValueChange={(value) =>
              void commit({
                managerId:
                  typeof value === "string" && value !== NONE ? value : null,
              })
            }
          >
            <SelectTrigger
              id="project-planning-manager"
              className="w-full sm:w-64"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {managerItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className={ROW}>
          <Label htmlFor="project-planning-start" className="font-medium">
            {t("settings:projectGeneral.planning.startDate")}
          </Label>
          <div className="w-full sm:w-64">
            <DateField
              id="project-planning-start"
              value={values.startDate}
              disabled={!canEditPlanning || isSaving}
              placeholder={t("settings:projectGeneral.planning.noDate")}
              clearLabel={t("settings:projectGeneral.planning.clearDate")}
              bound={endDay ? { after: endDay } : undefined}
              invalid={errors.endBeforeStart}
              onChange={(value) => void commit({ startDate: value })}
            />
          </div>
        </div>

        <Separator />

        <div className={ROW}>
          <div className="space-y-0.5">
            <Label htmlFor="project-planning-end" className="font-medium">
              {t("settings:projectGeneral.planning.endDate")}
            </Label>
            {errors.endBeforeStart && (
              <p role="alert" className="text-xs text-destructive">
                {t("settings:projectGeneral.planning.failure.datesOrdered")}
              </p>
            )}
          </div>
          <div className="w-full sm:w-64">
            <DateField
              id="project-planning-end"
              value={values.endDate}
              disabled={!canEditPlanning || isSaving}
              placeholder={t("settings:projectGeneral.planning.noDate")}
              clearLabel={t("settings:projectGeneral.planning.clearDate")}
              bound={startDay ? { before: startDay } : undefined}
              invalid={errors.endBeforeStart}
              onChange={(value) => void commit({ endDate: value })}
            />
          </div>
        </div>

        <Separator />

        <div className={ROW}>
          <div className="space-y-0.5">
            <Label
              htmlFor="project-planning-default-assignee"
              className="font-medium"
            >
              {t("settings:projectGeneral.planning.defaultAssignee")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings:projectGeneral.planning.defaultAssigneeHint")}
            </p>
          </div>
          <Select
            items={assigneeItems}
            value={values.defaultAssigneeId ?? NONE}
            disabled={!canEditPlanning || isSaving || peopleLoading}
            onValueChange={(value) =>
              void commit({
                defaultAssigneeId:
                  typeof value === "string" && value !== NONE ? value : null,
              })
            }
          >
            <SelectTrigger
              id="project-planning-default-assignee"
              className="w-full sm:w-64"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assigneeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ReparentPreviewDialog
        projectId={project.id}
        parentId={pendingParentId}
        parentName={
          pendingParentId
            ? (parentItems.find((item) => item.value === pendingParentId)
                ?.label ?? null)
            : null
        }
        isMoving={isMoving}
        onConfirm={() => void confirmParent()}
        onCancel={() => setPendingParentId(undefined)}
      />

      {saveFailure && (
        <Alert variant="error" role="alert">
          <AlertDescription>
            {t(`settings:projectGeneral.planning.failure.${saveFailure}`)}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

export default ProjectPlanningSettings;
