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
import { TerminologyEditor } from "@/components/settings/terminology-editor";
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
  Exclude<
    keyof InstanceSettings,
    | "attachmentAllowedExtensions"
    | "timezone"
    | "anonymousRateLimitWindowMs"
    | "cspMode"
  >,
  string
> & {
  timezone: string;
  attachmentAllowedExtensions: string;
  anonymousRateLimitWindowMinutes: string;
  cspMode: InstanceSettings["cspMode"];
};

function toDraft(settings: InstanceSettings): Draft {
  return {
    approvalDefaultExpiryDays: String(settings.approvalDefaultExpiryDays),
    clarificationWindowDays: String(settings.clarificationWindowDays),
    reopenWindowDays: String(settings.reopenWindowDays),
    notificationRetentionDays: String(settings.notificationRetentionDays),
    cspMode: settings.cspMode,
    invitationLifetimeHours: String(settings.invitationLifetimeHours),
    customerInvitationCreateWindowMinutes: String(
      settings.customerInvitationCreateWindowMinutes,
    ),
    customerInvitationPerInviterLimit: String(
      settings.customerInvitationPerInviterLimit,
    ),
    customerInvitationPerOrganisationLimit: String(
      settings.customerInvitationPerOrganisationLimit,
    ),
    customerInvitationResendCooldownSeconds: String(
      settings.customerInvitationResendCooldownSeconds,
    ),
    anonymousRateLimitWindowMinutes: String(
      settings.anonymousRateLimitWindowMs / 60_000,
    ),
    anonymousRateLimitMax: String(settings.anonymousRateLimitMax),
    mcpWriteCeilingPerMinute: String(settings.mcpWriteCeilingPerMinute),
    apiKeyBurstThreshold: String(settings.apiKeyBurstThreshold),
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
  "invitationLifetimeHours",
  "customerInvitationCreateWindowMinutes",
  "customerInvitationPerInviterLimit",
  "customerInvitationPerOrganisationLimit",
  "customerInvitationResendCooldownSeconds",
  "anonymousRateLimitMax",
  "mcpWriteCeilingPerMinute",
  "apiKeyBurstThreshold",
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
  const windowMs = Number(draft.anonymousRateLimitWindowMinutes) * 60_000;
  if (windowMs !== original.anonymousRateLimitWindowMs)
    changes.anonymousRateLimitWindowMs = windowMs;
  if (draft.timezone !== original.timezone) changes.timezone = draft.timezone;
  if (draft.cspMode !== original.cspMode) changes.cspMode = draft.cspMode;
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
  return (
    <div className="space-y-6">
      <SettingsFields key={query.data.updatedAt} loaded={query.data} />
      <TerminologyEditor target={{ scope: "instance" }} />
    </div>
  );
}

function SettingsFields({ loaded }: { loaded: InstanceSettingsResponse }) {
  const { t } = useTranslation("godModeSettings");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toDraft(loaded.settings));
  const zones = useMemo(
    () => timezoneOptions(loaded.settings.timezone),
    [loaded.settings.timezone],
  );
  const cspModeOptions = [
    {
      value: "report_only" as const,
      label: t("cspModeOptions.reportOnly"),
    },
    { value: "enforce" as const, label: t("cspModeOptions.enforce") },
  ];
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
  function numberField(
    key: (typeof numericKeys)[number],
    min: number,
    max?: number,
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={`setting-${key}`}>{t(`fields.${key}.label`)}</Label>
        <Input
          id={`setting-${key}`}
          type="number"
          min={min}
          max={max}
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
          <CardTitle>{t("contentSecurityPolicy.title")}</CardTitle>
          <CardDescription>
            {t("contentSecurityPolicy.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-2">
            <Label htmlFor="setting-cspMode">{t("fields.cspMode.label")}</Label>
            <Select
              items={cspModeOptions}
              value={draft.cspMode}
              onValueChange={(value) => {
                if (value === "report_only" || value === "enforce")
                  set("cspMode", value);
              }}
              disabled={save.isPending}
            >
              <SelectTrigger id="setting-cspMode">
                <SelectValue>
                  {t(
                    draft.cspMode === "report_only"
                      ? "cspModeOptions.reportOnly"
                      : "cspModeOptions.enforce",
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="report_only">
                  {t("cspModeOptions.reportOnly")}
                </SelectItem>
                <SelectItem value="enforce">
                  {t("cspModeOptions.enforce")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {t("fields.cspMode.help")}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("anonymousRateLimit.title")}</CardTitle>
          <CardDescription>
            {t("anonymousRateLimit.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="setting-anonymousRateLimitWindowMinutes">
              {t("fields.anonymousRateLimitWindowMinutes.label")}
            </Label>
            <Input
              id="setting-anonymousRateLimitWindowMinutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              value={draft.anonymousRateLimitWindowMinutes}
              disabled={save.isPending}
              onChange={(event) =>
                set("anonymousRateLimitWindowMinutes", event.target.value)
              }
            />
            <p className="text-muted-foreground text-xs">
              {t("fields.anonymousRateLimitWindowMinutes.help")}
            </p>
          </div>
          {numberField("anonymousRateLimitMax", 1, 10_000)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invitationLimits.title")}</CardTitle>
          <CardDescription>{t("invitationLimits.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {numberField("invitationLifetimeHours", 1, 720)}
          {numberField("customerInvitationCreateWindowMinutes", 1, 1440)}
          {numberField("customerInvitationPerInviterLimit", 1, 10_000)}
          {numberField("customerInvitationPerOrganisationLimit", 1, 10_000)}
          {numberField("customerInvitationResendCooldownSeconds", 1, 86_400)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("mcpRateLimit.title")}</CardTitle>
          <CardDescription>{t("mcpRateLimit.description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {numberField("mcpWriteCeilingPerMinute", 1, 100)}
          {numberField("apiKeyBurstThreshold", 1, 100_000)}
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
