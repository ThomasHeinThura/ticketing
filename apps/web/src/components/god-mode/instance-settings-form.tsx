import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getInstanceSettings,
  type InstanceSettings,
  InstanceSettingsConflictError,
  type InstanceSettingsResponse,
  patchInstanceSettings,
} from "@/fetchers/god-mode/instance-settings";
import { formatDateTime } from "@/lib/format";

const queryKey = ["instance", "settings"] as const;

/** The IANA zones this browser knows, with UTC first. */
function timezoneOptions(current: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return [...new Set(["UTC", current, ...supported])];
}

type Draft = Record<
  Exclude<keyof InstanceSettings, "attachmentAllowedExtensions" | "timezone">,
  string
> & { timezone: string; attachmentAllowedExtensions: string };

function toDraft(settings: InstanceSettings): Draft {
  return {
    approvalDefaultExpiryDays: String(settings.approvalDefaultExpiryDays),
    clarificationWindowDays: String(settings.clarificationWindowDays),
    reopenWindowDays: String(settings.reopenWindowDays),
    notificationRetentionDays: String(settings.notificationRetentionDays),
    timezone: settings.timezone,
    attachmentMaxBytes: String(settings.attachmentMaxBytes),
    attachmentMaxPerItem: String(settings.attachmentMaxPerItem),
    attachmentAllowedExtensions:
      settings.attachmentAllowedExtensions.join(", "),
  };
}

const numericKeys = [
  "approvalDefaultExpiryDays",
  "clarificationWindowDays",
  "reopenWindowDays",
  "notificationRetentionDays",
  "attachmentMaxBytes",
  "attachmentMaxPerItem",
] as const;

/** Only the keys that differ from what was loaded are sent. */
function diff(
  original: InstanceSettings,
  draft: Draft,
): Partial<InstanceSettings> {
  const changes: Partial<InstanceSettings> = {};
  for (const key of numericKeys) {
    const value = Number(draft[key]);
    if (value !== original[key]) changes[key] = value;
  }
  if (draft.timezone !== original.timezone) changes.timezone = draft.timezone;
  const extensions = draft.attachmentAllowedExtensions
    .split(/[\s,]+/u)
    .map((value) => value.trim().replace(/^\./u, "").toLowerCase())
    .filter(Boolean);
  if (extensions.join(",") !== original.attachmentAllowedExtensions.join(","))
    changes.attachmentAllowedExtensions = extensions;
  return changes;
}

export function InstanceSettingsForm() {
  const { t } = useTranslation("godModeSettings");
  const query = useQuery({
    queryKey,
    queryFn: getInstanceSettings,
    retry: false,
  });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError)
    return (
      <Alert variant="error">
        <AlertTitle>{t("unavailable")}</AlertTitle>
        <AlertDescription>{t("loadFailed")}</AlertDescription>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("retry")}
        </Button>
      </Alert>
    );
  return <SettingsFields key={query.data.updatedAt} loaded={query.data} />;
}

function SettingsFields({ loaded }: { loaded: InstanceSettingsResponse }) {
  const { t } = useTranslation("godModeSettings");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(loaded.settings));
  const zones = useMemo(
    () => timezoneOptions(loaded.settings.timezone),
    [loaded.settings.timezone],
  );
  const changes = diff(loaded.settings, draft);
  const dirty = Object.keys(changes).length > 0;
  const save = useMutation({
    mutationFn: () =>
      patchInstanceSettings({ expectedUpdatedAt: loaded.updatedAt, changes }),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error) => {
      if (error instanceof InstanceSettingsConflictError)
        void queryClient.invalidateQueries({ queryKey });
    },
  });
  const conflict = save.error instanceof InstanceSettingsConflictError;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    save.reset();
  }
  function numberField(key: (typeof numericKeys)[number], min: number) {
    return (
      <div className="space-y-2">
        <Label htmlFor={`setting-${key}`}>{t(`fields.${key}.label`)}</Label>
        <Input
          id={`setting-${key}`}
          type="number"
          min={min}
          value={draft[key]}
          disabled={save.isPending}
          onChange={(event) => set(key, event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          {t(`fields.${key}.help`)}
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }}
    >
      {conflict ? (
        <Alert variant="warning" role="alert">
          <AlertTitle>{t("conflictTitle")}</AlertTitle>
          <AlertDescription>{t("conflict")}</AlertDescription>
        </Alert>
      ) : save.isError ? (
        <Alert variant="error" role="alert">
          <AlertDescription>{t("saveFailed")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("general.title")}</CardTitle>
          <CardDescription>{t("general.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="setting-timezone">
              {t("fields.timezone.label")}
            </Label>
            <Select
              value={draft.timezone}
              onValueChange={(value) => value && set("timezone", value)}
              disabled={save.isPending}
            >
              <SelectTrigger id="setting-timezone">
                <SelectValue>{draft.timezone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t("fields.timezone.help")}
            </p>
          </div>
          {numberField("notificationRetentionDays", 1)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("windows.title")}</CardTitle>
          <CardDescription>{t("windows.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {numberField("approvalDefaultExpiryDays", 1)}
          {numberField("clarificationWindowDays", 1)}
          {numberField("reopenWindowDays", 1)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("attachments.title")}</CardTitle>
          <CardDescription>{t("attachments.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {numberField("attachmentMaxBytes", 1024)}
          {numberField("attachmentMaxPerItem", 1)}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="setting-extensions">
              {t("fields.attachmentAllowedExtensions.label")}
            </Label>
            <Input
              id="setting-extensions"
              value={draft.attachmentAllowedExtensions}
              disabled={save.isPending}
              onChange={(event) =>
                set("attachmentAllowedExtensions", event.target.value)
              }
            />
            <p className="text-muted-foreground text-xs">
              {t("fields.attachmentAllowedExtensions.help")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {t("save")}
        </Button>
        <p className="text-muted-foreground text-xs">
          {t("lastChanged", { when: formatDateTime(loaded.updatedAt) })}
        </p>
      </div>
    </form>
  );
}
