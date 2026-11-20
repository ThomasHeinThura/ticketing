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
  LoadingStatus,
  SAVE_FEEDBACK_HOLD_MS,
  SaveButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshSettingsHistory } from "@/components/settings/refresh-settings-history";
import { SettingsHistory } from "@/components/settings/settings-history";
import { TerminologyEditor } from "@/components/settings/terminology-editor";
import {
  getInstanceSettings,
  type InstanceSettings,
  InstanceSettingsConflictError,
  type InstanceSettingsResponse,
  patchInstanceSettings,
} from "@/fetchers/god-mode/instance-settings";
import { settingsHistoryQueryKey } from "@/fetchers/settings/settings-history";
import { useInstanceAdminSignal } from "@/hooks/use-instance-admin-signal";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";
import { profileSessionGuard } from "@/lib/profile-session-guard";

/** Prefix of every browser session's settings entry. */
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

type HistoryIdentity = { userId: string; sessionId: string };

/**
 * The browser user and session the settings belong to: they scope the read, the write result and
 * the draft, so another session's answer or draft can never stand in for this one's. History also
 * needs a staff session: an administrator, never impersonated or portal.
 */
function useSettingsIdentity(): {
  scope: HistoryIdentity | null;
  history: HistoryIdentity | null;
} {
  const isAdmin = useInstanceAdminSignal();
  const { data: session } = authClient.useSession();
  const flags = session?.session as
    | { portal?: string | null; impersonatedBy?: string | null }
    | undefined;
  const userId = session?.user?.id;
  const sessionId = session?.session?.id;
  const scope = userId && sessionId ? { userId, sessionId } : null;
  const staff =
    isAdmin &&
    !flags?.impersonatedBy &&
    (!flags?.portal || flags.portal === "agent");
  return { scope, history: staff ? scope : null };
}

const scopeKey = (scope: HistoryIdentity | null) =>
  scope ? `${scope.userId}:${scope.sessionId}` : null;

export function InstanceSettingsForm() {
  const { t } = useTranslation("godModeSettings");
  const { scope, history: identity } = useSettingsIdentity();
  const scopeId = scopeKey(scope);
  // Which scope the Saved feedback belongs to: a late answer for another session never shows here.
  const [completedFor, setCompletedFor] = useState<string | null>(null);
  const completed = completedFor !== null && completedFor === scopeId;
  // The conflict notice outlives the fields remount a newer version causes; it clears at the next edit or save.
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  const conflict = conflictFor !== null && conflictFor === scopeId;
  // Callbacks of an earlier session's save run with stale closures: they are admitted by the scope that is committed when they run.
  const currentScope = useRef(scopeId);
  useLayoutEffect(() => {
    currentScope.current = scopeId;
  }, [scopeId]);
  const ifCurrent =
    (setter: (scope: string | null) => void) => (saved: string | null) => {
      if (saved === currentScope.current) setter(saved);
    };
  useEffect(() => {
    if (!completedFor) return;
    const timer = setTimeout(
      () => setCompletedFor(null),
      SAVE_FEEDBACK_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [completedFor]);
  const settingsKey = [
    ...queryKey,
    scope?.userId ?? null,
    scope?.sessionId ?? null,
  ] as const;
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: getInstanceSettings,
    // No read without a browser session: the identity scopes the entry.
    enabled: scope !== null,
    retry: false,
  });
  const queryPlaceholderVisible = useDelayedPending(query.isPending);
  if (
    !query.isError &&
    (query.isPending || (queryPlaceholderVisible && query.data))
  )
    return (
      <LoadingStatus
        visible={queryPlaceholderVisible}
        label={t("common:empty.loading")}
      >
        <Skeleton
          className="h-64 w-full"
          style={{ visibility: queryPlaceholderVisible ? "visible" : "hidden" }}
        />
      </LoadingStatus>
    );
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
      <SettingsFields
        key={`${scopeId}:${query.data.updatedAt}`}
        loaded={query.data}
        identity={identity}
        scopeId={scopeId}
        settingsKey={settingsKey}
        completed={completed}
        conflict={conflict}
        onStart={() => {
          setCompletedFor(null);
          setConflictFor(null);
        }}
        onEdit={() => setConflictFor(null)}
        onSaved={ifCurrent(setCompletedFor)}
        onConflict={ifCurrent(setConflictFor)}
      />
      {/* Mounted only after the settings read succeeded; outside the keyed fields so a save does not remount it. */}
      {identity ? (
        <SettingsHistory
          type="instance"
          id="singleton"
          userId={identity.userId}
        />
      ) : null}
      <TerminologyEditor target={{ scope: "instance" }} />
    </div>
  );
}

type SaveVariables = {
  identity: HistoryIdentity | null;
  scopeId: string | null;
  settingsKey: readonly unknown[];
};

function SettingsFields({
  loaded,
  identity,
  scopeId,
  settingsKey,
  completed,
  conflict,
  onStart,
  onEdit,
  onSaved,
  onConflict,
}: {
  loaded: InstanceSettingsResponse;
  identity: HistoryIdentity | null;
  scopeId: string | null;
  settingsKey: readonly unknown[];
  completed: boolean;
  conflict: boolean;
  onStart: () => void;
  onEdit: () => void;
  onSaved: (scopeId: string | null) => void;
  onConflict: (scopeId: string | null) => void;
}) {
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
    // The session scope is captured when the write starts, so a later session change cannot
    // redirect the result, the Saved feedback or the History refresh.
    mutationFn: (_captured: SaveVariables) =>
      patchInstanceSettings({ expectedUpdatedAt: loaded.updatedAt, changes }),
    onSuccess: (
      next,
      { identity: savedIdentity, scopeId: savedScope, settingsKey: savedKey },
    ) => {
      queryClient.setQueryData(savedKey, next);
      onSaved(savedScope);
      if (savedIdentity)
        refreshSettingsHistory(
          queryClient,
          settingsHistoryQueryKey(
            "instance",
            "singleton",
            savedIdentity.userId,
            savedIdentity.sessionId,
          ),
          profileSessionGuard(savedIdentity.userId, savedIdentity.sessionId),
        );
    },
    // Only the submitting session's entry: a late conflict must not refetch another session's form.
    onError: (error, { settingsKey: savedKey, scopeId: savedScope }) => {
      if (error instanceof InstanceSettingsConflictError) {
        onConflict(savedScope);
        void queryClient.invalidateQueries({
          queryKey: savedKey,
          exact: true,
        });
      }
    },
  });

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    save.reset();
    onEdit();
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
        if (dirty && !save.isPending) {
          onStart();
          save.mutate({ identity, scopeId, settingsKey });
        }
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
        <SaveButton
          type="submit"
          disabled={!dirty && !save.isPending}
          pending={save.isPending}
          success={completed}
          retainedSuccess
          savedLabel={t("common:actions.saved")}
          workingLabel={t("common:actions.saving")}
        >
          {t("save")}
        </SaveButton>
        <p className="text-muted-foreground text-xs">
          {t("lastChanged", { when: formatDateTime(loaded.updatedAt) })}
        </p>
      </div>
    </form>
  );
}
