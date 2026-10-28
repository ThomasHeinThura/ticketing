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
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getWorkspaceProjectSettings,
  patchWorkspaceProjectSettings,
  WorkspaceSettingsError,
} from "@/fetchers/project-settings-inheritance";
import {
  getServiceCalendars,
  type ServiceCalendar,
} from "@/fetchers/service-calendar";
import { getSlaPolicies } from "@/fetchers/sla-policy";
import useWorkspaceFeatures from "@/hooks/queries/feature-flag/use-workspace-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { HttpError } from "@/lib/http-error";

const isForbidden = (error: unknown) =>
  error instanceof HttpError && error.status === 403;

const NONE = "__none__";

async function allPages<T extends { page: { nextCursor: string | null } }>(
  load: (cursor?: string) => Promise<T>,
): Promise<T[]> {
  const pages: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await load(cursor);
    pages.push(result);
    const next = result.page.nextCursor;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return pages;
}

export function WorkspaceProjectDefaultsPanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canManageWorkspaceSettings, isCheckingPermissions } =
    useWorkspacePermission(workspaceId);
  const canEdit = canManageWorkspaceSettings();
  // P4R2-M1: the default SLA policy and service calendar are `feature.sla` settings; while the
  // flag is off for the workspace the panel is not offered (the lists would answer 404).
  const workspaceFeatures = useWorkspaceFeatures(workspaceId);
  const slaOn = workspaceFeatures.isOn("feature.sla");
  const queryKey = ["workspace", workspaceId, "project-settings"] as const;
  const settings = useQuery({
    queryKey,
    queryFn: () => getWorkspaceProjectSettings(workspaceId),
    enabled: Boolean(workspaceId) && slaOn,
  });
  const slaQuery = useQuery({
    queryKey: ["workspace", workspaceId, "project-default-sla-options"],
    enabled: Boolean(workspaceId) && slaOn,
    queryFn: async () => {
      const pages = await allPages((cursor) =>
        getSlaPolicies(workspaceId, cursor),
      );
      return pages.flatMap((page) => page.data);
    },
  });
  const calendarQuery = useQuery({
    queryKey: ["workspace", workspaceId, "project-default-calendar-options"],
    enabled: Boolean(workspaceId) && slaOn,
    queryFn: async () => {
      const pages = await allPages((cursor) =>
        getServiceCalendars(workspaceId, cursor),
      );
      return pages.flatMap((page) => page.data);
    },
  });
  const [slaId, setSlaId] = useState<string>(NONE);
  const [calendarId, setCalendarId] = useState<string>(NONE);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<
    "stale" | "forbidden" | "generic" | null
  >(null);

  useEffect(() => {
    const value = settings.data;
    if (!value || `${workspaceId}:${value.version}` === draftVersion) return;
    setSlaId(value.defaultSlaPolicyId ?? NONE);
    setCalendarId(value.defaultServiceCalendarId ?? NONE);
    setDraftVersion(`${workspaceId}:${value.version}`);
    setFailure(null);
  }, [settings.data, draftVersion, workspaceId]);
  useEffect(() => {
    if (
      [settings.error, slaQuery.error, calendarQuery.error].some(isForbidden)
    ) {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", workspaceId],
      });
    }
  }, [
    settings.error,
    slaQuery.error,
    calendarQuery.error,
    queryClient,
    workspaceId,
  ]);

  const slaPolicies = slaQuery.data ?? [];
  const calendars = calendarQuery.data ?? [];
  const current = settings.data;
  const slaOptions = useMemo(() => {
    const options = slaPolicies.map((item) => ({
      id: item.id,
      name: item.name,
    }));
    if (
      current?.defaultSlaPolicyId &&
      !options.some((item) => item.id === current.defaultSlaPolicyId)
    ) {
      options.push({
        id: current.defaultSlaPolicyId,
        name: t("settings:workspaceProjectDefaults.unlisted"),
      });
    }
    return options;
  }, [slaPolicies, current?.defaultSlaPolicyId, t]);
  const calendarOptions = useMemo(() => {
    const options = calendars.map((item: ServiceCalendar) => ({
      id: item.id,
      name: item.name,
    }));
    if (
      current?.defaultServiceCalendarId &&
      !options.some((item) => item.id === current.defaultServiceCalendarId)
    ) {
      options.push({
        id: current.defaultServiceCalendarId,
        name: t("settings:workspaceProjectDefaults.unlisted"),
      });
    }
    return options;
  }, [calendars, current?.defaultServiceCalendarId, t]);

  const dirty = Boolean(
    current &&
      ((slaId === NONE ? null : slaId) !== current.defaultSlaPolicyId ||
        (calendarId === NONE ? null : calendarId) !==
          current.defaultServiceCalendarId),
  );
  const save = async () => {
    if (!current || !dirty || saving || !canEdit) return;
    setFailure(null);
    setSaving(true);
    try {
      const updated = await patchWorkspaceProjectSettings(workspaceId, {
        expectedVersion: current.version,
        defaultSlaPolicyId: slaId === NONE ? null : slaId,
        defaultServiceCalendarId: calendarId === NONE ? null : calendarId,
      });
      queryClient.setQueryData(queryKey, updated);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDraftVersion(`${workspaceId}:${updated.version}`);
    } catch (error) {
      setFailure(
        error instanceof WorkspaceSettingsError && error.status === 409
          ? "stale"
          : error instanceof WorkspaceSettingsError && error.status === 403
            ? "forbidden"
            : "generic",
      );
      if (error instanceof WorkspaceSettingsError && error.status === 403) {
        void queryClient.invalidateQueries({
          queryKey: ["workspace-capabilities", workspaceId],
        });
      }
      if (error instanceof WorkspaceSettingsError && error.status === 409) {
        void settings.refetch();
      }
    } finally {
      setSaving(false);
    }
  };

  if (!workspaceFeatures.isLoading && !slaOn) return null;
  const loading =
    workspaceFeatures.isLoading ||
    settings.isLoading ||
    slaQuery.isLoading ||
    calendarQuery.isLoading;
  const loadError =
    settings.isError || slaQuery.isError || calendarQuery.isError;
  if (loading) {
    return (
      <section
        className="space-y-3"
        aria-busy="true"
        data-testid="workspace-project-defaults-loading"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </section>
    );
  }

  return (
    <section
      className="space-y-4"
      aria-labelledby="workspace-project-defaults-title"
      data-testid="workspace-project-defaults"
    >
      <div className="space-y-1">
        <h2
          id="workspace-project-defaults-title"
          className="text-md font-medium"
        >
          {t("settings:workspaceProjectDefaults.title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings:workspaceProjectDefaults.description")}
        </p>
      </div>
      {loadError ? (
        <Alert variant="error" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {t(
              [settings.error, slaQuery.error, calendarQuery.error].some(
                isForbidden,
              )
                ? "settings:workspaceProjectDefaults.forbidden"
                : "settings:workspaceProjectDefaults.loadError",
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void Promise.all([
                  settings.refetch(),
                  slaQuery.refetch(),
                  calendarQuery.refetch(),
                ])
              }
            >
              {t("settings:workspaceProjectDefaults.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4 rounded-md border border-border bg-sidebar p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="workspace-default-sla"
              >
                {t("settings:workspaceProjectDefaults.defaultSlaPolicy")}
              </label>
              <Select
                items={[
                  {
                    value: NONE,
                    label: t("settings:workspaceProjectDefaults.none"),
                  },
                  ...slaOptions.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
                value={slaId}
                disabled={!canEdit || saving || slaQuery.isError}
                onValueChange={(value) =>
                  typeof value === "string" && setSlaId(value)
                }
              >
                <SelectTrigger id="workspace-default-sla" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("settings:workspaceProjectDefaults.none")}
                  </SelectItem>
                  {slaOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="workspace-default-calendar"
              >
                {t("settings:workspaceProjectDefaults.defaultServiceCalendar")}
              </label>
              <Select
                items={[
                  {
                    value: NONE,
                    label: t("settings:workspaceProjectDefaults.none"),
                  },
                  ...calendarOptions.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
                value={calendarId}
                disabled={!canEdit || saving || calendarQuery.isError}
                onValueChange={(value) =>
                  typeof value === "string" && setCalendarId(value)
                }
              >
                <SelectTrigger
                  id="workspace-default-calendar"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("settings:workspaceProjectDefaults.none")}
                  </SelectItem>
                  {calendarOptions.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {failure && (
            <Alert variant="error" role="alert">
              <AlertDescription>
                {t(`settings:workspaceProjectDefaults.${failure}`)}
              </AlertDescription>
            </Alert>
          )}
          {canEdit && (
            <Button
              type="button"
              size="sm"
              disabled={!dirty || saving || isCheckingPermissions}
              onClick={() => void save()}
            >
              {saving
                ? t("settings:workspaceProjectDefaults.saving")
                : t("settings:workspaceProjectDefaults.save")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
