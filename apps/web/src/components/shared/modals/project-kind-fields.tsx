import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useTranslation } from "react-i18next";
import {
  ENGAGEMENT_KINDS,
  type EngagementKind,
  isEngagementKind,
  isSupportLevel,
  SUPPORT_LEVELS,
  type SupportLevel,
} from "@/components/project/project-engagement-form";
import { getWorkspaceProjectSettings } from "@/fetchers/project-settings-inheritance";
import useWorkspaceFeatures from "@/hooks/queries/feature-flag/use-workspace-features";
import { useServiceCalendars } from "@/hooks/queries/service-calendar/use-service-calendars";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";

/** The "use the default calendar" choice: the API then inherits (never sent as null). */
export const INHERIT_CALENDAR = "__inherit__";
const NO_SUPPORT_LEVEL = "__none__";

export type ProjectKindValues = {
  kind: EngagementKind;
  supportLevel: SupportLevel | null;
  /** A calendar id, or `INHERIT_CALENDAR`. */
  calendarChoice: string;
};

export const DEFAULT_PROJECT_KIND_VALUES: ProjectKindValues = {
  kind: "project",
  supportLevel: null,
  calendarChoice: INHERIT_CALENDAR,
};

/**
 * What the managed-service calendar choice can resolve to. Calendars are a `feature.sla`
 * setting (the list answers 404 while it is off), so without it only the default is offered.
 * The workspace default is known only to callers who can read the workspace project settings;
 * `undefined` means "unknown", and the API's PR-9 check stays the final word.
 */
export function useManagedServiceOptions(workspaceId: string, active: boolean) {
  const features = useWorkspaceFeatures(workspaceId, active);
  const slaOn = features.isOn("feature.sla");
  const { canManageWorkspaceSettings } = useWorkspacePermission();
  const canReadDefaults = canManageWorkspaceSettings() === true;
  const calendars = useServiceCalendars(
    workspaceId,
    undefined,
    active && slaOn,
  );
  const settings = useQuery({
    queryKey: ["workspace", workspaceId, "project-settings"],
    queryFn: () => getWorkspaceProjectSettings(workspaceId),
    enabled: Boolean(workspaceId) && active && canReadDefaults,
    retry: false,
  });
  return {
    slaOn,
    featuresLoading: features.isLoading,
    calendars,
    workspaceDefaultCalendarId: settings.isSuccess
      ? settings.data.defaultServiceCalendarId
      : undefined,
  };
}

/**
 * True when the managed-service choice is known to be incomplete: no support level, or the
 * default calendar was chosen for an internal project in a workspace that has none. With a
 * customer organisation the organisation's own default may apply, so the API decides.
 */
export function isManagedServiceIncomplete(
  values: ProjectKindValues,
  workspaceDefaultCalendarId: string | null | undefined,
  hasOrganisation: boolean,
) {
  if (values.kind !== "managed_service") return false;
  if (!values.supportLevel) return true;
  return (
    values.calendarChoice === INHERIT_CALENDAR &&
    !hasOrganisation &&
    workspaceDefaultCalendarId === null
  );
}

export function ProjectKindFields({
  options,
  values,
  onChange,
  hasOrganisation,
  disabled,
}: {
  options: ReturnType<typeof useManagedServiceOptions>;
  values: ProjectKindValues;
  onChange: (values: ProjectKindValues) => void;
  hasOrganisation: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const managed = values.kind === "managed_service";
  const calendarList = options.calendars.data?.data ?? [];
  const defaultCalendarName =
    options.workspaceDefaultCalendarId != null
      ? calendarList.find(
          (calendar) => calendar.id === options.workspaceDefaultCalendarId,
        )?.name
      : undefined;
  const inheritLabel = defaultCalendarName
    ? t("common:modals.createProject.calendarInheritNamed", {
        name: defaultCalendarName,
      })
    : t("common:modals.createProject.calendarInherit");
  const calendarItems = [
    { value: INHERIT_CALENDAR, label: inheritLabel },
    ...(options.slaOn
      ? calendarList.map((calendar) => ({
          value: calendar.id,
          label: calendar.name,
        }))
      : []),
  ];
  const selectedCalendar = calendarItems.some(
    (item) => item.value === values.calendarChoice,
  )
    ? values.calendarChoice
    : INHERIT_CALENDAR;
  const supportItems = SUPPORT_LEVELS.map((level) => ({
    value: level,
    label: t("common:modals.createProject.supportLevelOption", { level }),
  }));
  const noDefault =
    selectedCalendar === INHERIT_CALENDAR &&
    !hasOrganisation &&
    options.workspaceDefaultCalendarId === null;

  return (
    <div className="space-y-3 px-3" data-testid="project-kind">
      <div className="space-y-1.5">
        <span
          id="project-kind-label"
          className="text-sm font-medium text-foreground"
        >
          {t("common:modals.createProject.kindLabel")}
        </span>
        <RadioGroup
          value={values.kind}
          onValueChange={(value) => {
            if (isEngagementKind(value)) onChange({ ...values, kind: value });
          }}
          aria-labelledby="project-kind-label"
          className="grid gap-2"
          disabled={disabled}
        >
          {ENGAGEMENT_KINDS.map((kind) => {
            const id = `project-kind-${kind}`;
            const checked = values.kind === kind;
            return (
              <Label
                key={kind}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 font-normal transition-colors duration-150",
                  checked
                    ? "bg-muted/50 border-primary/40"
                    : "hover:bg-muted/30",
                )}
              >
                <RadioGroupItem id={id} value={kind} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {kind === "managed_service"
                      ? t("common:modals.createProject.kindManaged")
                      : t("common:modals.createProject.kindDelivery")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {kind === "managed_service"
                      ? t("common:modals.createProject.kindManagedHint")
                      : t("common:modals.createProject.kindDeliveryHint")}
                  </span>
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      </div>

      {managed ? (
        <div
          className="grid gap-3 sm:grid-cols-2"
          data-testid="project-managed-service-fields"
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-support-level">
              {t("common:modals.createProject.supportLevelLabel")}
            </Label>
            <Select
              items={supportItems}
              value={values.supportLevel ?? NO_SUPPORT_LEVEL}
              disabled={disabled}
              onValueChange={(value) => {
                if (isSupportLevel(value))
                  onChange({ ...values, supportLevel: value });
              }}
            >
              <SelectTrigger id="project-support-level">
                <SelectValue
                  placeholder={t(
                    "common:modals.createProject.supportLevelPlaceholder",
                  )}
                >
                  {values.supportLevel
                    ? t("common:modals.createProject.supportLevelOption", {
                        level: values.supportLevel,
                      })
                    : t("common:modals.createProject.supportLevelPlaceholder")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {supportItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-service-calendar">
              {t("common:modals.createProject.calendarLabel")}
            </Label>
            <Select
              items={calendarItems}
              value={selectedCalendar}
              disabled={disabled}
              onValueChange={(value) => {
                if (value !== null)
                  onChange({ ...values, calendarChoice: value });
              }}
            >
              <SelectTrigger
                id="project-service-calendar"
                aria-invalid={noDefault ? true : undefined}
                aria-describedby="project-service-calendar-hint"
              >
                <SelectValue>
                  {calendarItems.find((item) => item.value === selectedCalendar)
                    ?.label ?? inheritLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {calendarItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            id="project-service-calendar-hint"
            className="text-xs sm:col-span-2"
          >
            {options.slaOn && options.calendars.isPending ? (
              <p role="status" className="text-muted-foreground">
                {t("common:modals.createProject.calendarsLoading")}
              </p>
            ) : options.slaOn && options.calendars.isError ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 text-destructive"
              >
                <span>{t("common:modals.createProject.calendarsError")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => options.calendars.refetch()}
                >
                  {t("common:modals.createProject.calendarsRetry")}
                </Button>
              </div>
            ) : noDefault ? (
              <p
                role="alert"
                className="text-destructive"
                data-testid="project-calendar-no-default"
              >
                {options.slaOn && calendarList.length > 0
                  ? t("common:modals.createProject.calendarNoDefault")
                  : t("common:modals.createProject.calendarNoneAvailable")}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {t("common:modals.createProject.calendarHint")}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
