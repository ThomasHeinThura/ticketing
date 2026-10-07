import { apiFetch } from "@taskdesk/libs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";
import { ScimGroupMappingsSettings } from "./scim-group-mappings-settings";
import { ScimTokenSettings } from "./scim-token-settings";

const REQUIRED_MATCH_ATTRIBUTES = ["externalId", "userName"] as const;
const OPTIONAL_MATCH_ATTRIBUTES = [
  "displayName",
  "name.formatted",
  "title",
  "preferredLanguage",
] as const;
type OptionalMatchAttribute = (typeof OPTIONAL_MATCH_ATTRIBUTES)[number];
type MatchAttribute =
  | (typeof REQUIRED_MATCH_ATTRIBUTES)[number]
  | OptionalMatchAttribute;
type ProfileMapping = ScimSettings["attributeMapping"];
type LifecyclePolicy = ScimSettings["lifecyclePolicy"];

const PROFILE_MAPPING_OPTIONS = {
  name: ["displayName", "name.formatted"],
  email: ["emails.primary.value", "userName"],
  jobTitle: ["title", "unmapped"],
  locale: ["preferredLanguage", "locale", "unmapped"],
} as const;

type ScimSettings = {
  enabled: boolean;
  allowedResources: Array<"users" | "groups">;
  lifecyclePolicy: "end_memberships" | "keep_memberships";
  matchAttributes: MatchAttribute[];
  attributeMapping: {
    version: 1;
    name: "displayName" | "name.formatted";
    email: "emails.primary.value" | "userName";
    jobTitle: "title" | "unmapped";
    locale: "preferredLanguage" | "locale" | "unmapped";
  };
  mappings: Array<{
    id: string;
    externalGroupId: string;
    externalGroupNameSnapshot: string | null;
    roleId: string;
    scope: "organisation" | "workspace";
    scopeId: string;
    enabled: boolean;
  }>;
};
type ScimSettingsResponse = { data: ScimSettings; configVersion: number };
class RequestFailure extends Error {
  constructor(readonly status: number) {
    super("Request failed");
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new RequestFailure(response.status);
  return (await response.json()) as T;
}

function errorText(
  error: unknown,
  operation: "load" | "save",
  t: (key: string) => string,
) {
  if (error instanceof RequestFailure) {
    if (error.status === 403) return t("scim.match.errors.forbidden");
    if (error.status === 404) return t("scim.match.errors.notFound");
    if (error.status === 409) return t("scim.match.errors.stale");
    if (error.status === 422) return t("scim.match.errors.invalid");
    if (error.status === 503) return t("scim.match.errors.unavailable");
  }
  return operation === "load"
    ? t("scim.match.errors.load")
    : t("scim.match.errors.save");
}

function hasChanged(
  current: readonly MatchAttribute[],
  draft: readonly MatchAttribute[],
) {
  return (
    current.length !== draft.length ||
    current.some((value, index) => value !== draft[index])
  );
}

export function ScimMatchAttributesSettings({
  connectionId,
}: {
  connectionId: string;
}) {
  const { t } = useTranslation("identityConnections");
  const [settings, setSettings] = useState<ScimSettingsResponse | null>(null);
  const [draft, setDraft] = useState<MatchAttribute[]>([]);
  const [groupsAllowed, setGroupsAllowed] = useState(false);
  const [lifecycleDraft, setLifecycleDraft] =
    useState<LifecyclePolicy>("end_memberships");
  const [profileDraft, setProfileDraft] = useState<ProfileMapping | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [canReloadSaveError, setCanReloadSaveError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [authMethod, setAuthMethod] = useState<
    "password" | "totp" | "backup_code"
  >("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const apiPath = useMemo(
    () =>
      `instance/identity-connections/${encodeURIComponent(connectionId)}/scim`,
    [connectionId],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setCanReloadSaveError(false);
    try {
      const response = await requestJson<ScimSettingsResponse>(apiPath);
      setSettings(response);
      setDraft([...response.data.matchAttributes]);
      setGroupsAllowed(response.data.allowedResources.includes("groups"));
      setLifecycleDraft(response.data.lifecyclePolicy);
      setProfileDraft({ ...response.data.attributeMapping });
      setSaveError(null);
    } catch (error) {
      setLoadError(errorText(error, "load", t));
      setSettings(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiPath, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changed = Boolean(
    settings &&
      (hasChanged(settings.data.matchAttributes, draft) ||
        settings.data.allowedResources.includes("groups") !== groupsAllowed ||
        settings.data.lifecyclePolicy !== lifecycleDraft),
  );
  const profileChanged = Boolean(
    settings &&
      profileDraft &&
      JSON.stringify(settings.data.attributeMapping) !==
        JSON.stringify(profileDraft),
  );

  function recordTokenMutation(configVersion: number, enabled: boolean) {
    setSettings((current) =>
      current
        ? {
            ...current,
            configVersion,
            data: { ...current.data, enabled },
          }
        : current,
    );
  }

  function toggleOptional(attribute: OptionalMatchAttribute, checked: boolean) {
    setDraft((current) => {
      const optional = OPTIONAL_MATCH_ATTRIBUTES.filter((candidate) =>
        candidate === attribute ? checked : current.includes(candidate),
      );
      return [...REQUIRED_MATCH_ATTRIBUTES, ...optional];
    });
    setSaveError(null);
    setCanReloadSaveError(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !changed) return;
    const request = {
      configVersion: settings.configVersion,
      kind: "settings" as const,
      ...(settings.data.allowedResources.includes("groups") === groupsAllowed
        ? {}
        : {
            allowedResources: [
              "users" as const,
              ...(groupsAllowed ? (["groups"] as const) : []),
            ],
          }),
      ...(settings.data.lifecyclePolicy === lifecycleDraft
        ? {}
        : { lifecyclePolicy: lifecycleDraft }),
      ...(hasChanged(settings.data.matchAttributes, draft)
        ? { matchAttributes: draft }
        : {}),
    };
    if (authMethod === "password" ? !password : !code) {
      setSaveError(
        authMethod === "password"
          ? t("scim.common.passwordRequired")
          : t("scim.common.codeRequired"),
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setCanReloadSaveError(false);
    try {
      const binding = {
        kind: "operation" as const,
        operation: "scim_admin_update" as const,
        connectionId,
        request,
      };
      const challenge = await requestJson<{
        challengeId: string;
        nonce: string;
      }>("me/step-up/challenges", {
        method: "POST",
        body: JSON.stringify(binding),
      });
      const proof = await requestJson<{ token: string }>("me/step-up", {
        method: "POST",
        body: JSON.stringify({
          ...binding,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: authMethod,
          ...(authMethod === "password" ? { password } : { code }),
        }),
      });
      const updated = await requestJson<ScimSettingsResponse>(apiPath, {
        method: "PATCH",
        headers: { "x-taskdesk-step-up-token": proof.token },
        body: JSON.stringify(request),
      });
      setSettings(updated);
      setDraft([...updated.data.matchAttributes]);
      setGroupsAllowed(updated.data.allowedResources.includes("groups"));
      setLifecycleDraft(updated.data.lifecyclePolicy);
      setPassword("");
      setCode("");
    } catch (error) {
      setSaveError(errorText(error, "save", t));
      setCanReloadSaveError(
        error instanceof RequestFailure && error.status === 409,
      );
      setPassword("");
      setCode("");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveProfileMapping(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !profileDraft || !profileChanged) return;
    const request = {
      configVersion: settings.configVersion,
      kind: "attribute_mapping" as const,
      attributeMapping: profileDraft,
    };
    if (authMethod === "password" ? !password : !code) {
      setSaveError(
        authMethod === "password"
          ? t("scim.common.passwordRequired")
          : t("scim.common.codeRequired"),
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setCanReloadSaveError(false);
    try {
      const binding = {
        kind: "operation" as const,
        operation: "scim_admin_update" as const,
        connectionId,
        request,
      };
      const challenge = await requestJson<{
        challengeId: string;
        nonce: string;
      }>("me/step-up/challenges", {
        method: "POST",
        body: JSON.stringify(binding),
      });
      const proof = await requestJson<{ token: string }>("me/step-up", {
        method: "POST",
        body: JSON.stringify({
          ...binding,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: authMethod,
          ...(authMethod === "password" ? { password } : { code }),
        }),
      });
      const updated = await requestJson<ScimSettingsResponse>(apiPath, {
        method: "PATCH",
        headers: { "x-taskdesk-step-up-token": proof.token },
        body: JSON.stringify(request),
      });
      setSettings(updated);
      setProfileDraft({ ...updated.data.attributeMapping });
      setPassword("");
      setCode("");
    } catch (error) {
      setSaveError(errorText(error, "save", t));
      setCanReloadSaveError(
        error instanceof RequestFailure && error.status === 409,
      );
      setPassword("");
      setCode("");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p role="status">{t("scim.match.loading")}</p>;
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <AlertTitle>{t("scim.match.unavailable")}</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Button onClick={() => void refresh()}>
            {t("scim.match.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!settings) return null;

  return (
    <section
      aria-labelledby="scim-match-attributes-heading"
      className="space-y-5"
    >
      <header className="space-y-1">
        <h2
          className="text-lg font-semibold"
          id="scim-match-attributes-heading"
        >
          {t("scim.match.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("scim.match.description")}
        </p>
      </header>

      <ScimGroupMappingsSettings
        configVersion={settings.configVersion}
        connectionId={connectionId}
        mappings={settings.data.mappings}
        onReload={() => void refresh()}
      />

      <fieldset className="space-y-3" disabled={isSaving}>
        <legend className="font-medium">{t("scim.match.resources")}</legend>
        <div className="flex items-start gap-3">
          <Checkbox checked disabled id="scim-resource-users" />
          <div className="space-y-0.5">
            <Label htmlFor="scim-resource-users">{t("scim.match.users")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("scim.match.requiredByConnection")}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={groupsAllowed}
            id="scim-resource-groups"
            onCheckedChange={(checked) => setGroupsAllowed(checked === true)}
          />
          <Label htmlFor="scim-resource-groups">{t("scim.match.groups")}</Label>
        </div>
      </fieldset>

      <div className="max-w-md space-y-2">
        <Label htmlFor="scim-lifecycle-policy">
          {t("scim.match.deactivationPolicy")}
        </Label>
        <Select
          disabled={isSaving}
          onValueChange={(value) => {
            if (value === "end_memberships" || value === "keep_memberships") {
              setLifecycleDraft(value);
            }
          }}
          value={lifecycleDraft}
        >
          <SelectTrigger
            aria-label={t("scim.match.deactivationPolicy")}
            id="scim-lifecycle-policy"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="end_memberships">
              {t("scim.match.endMemberships")}
            </SelectItem>
            <SelectItem value="keep_memberships">
              {t("scim.match.keepMemberships")}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {t("scim.match.futureDeactivations")}
        </p>
      </div>

      <fieldset className="space-y-3" disabled={isSaving}>
        <legend className="font-medium">
          {t("scim.match.supportedAttributes")}
        </legend>
        {REQUIRED_MATCH_ATTRIBUTES.map((attribute) => (
          <div className="flex items-start gap-3" key={attribute}>
            <Checkbox checked disabled id={`scim-match-${attribute}`} />
            <div className="space-y-0.5">
              <Label htmlFor={`scim-match-${attribute}`}>{attribute}</Label>
              <p className="text-sm text-muted-foreground">
                {t("scim.match.requiredForConnection")}
              </p>
            </div>
          </div>
        ))}
        {OPTIONAL_MATCH_ATTRIBUTES.map((attribute) => (
          <div className="flex items-start gap-3" key={attribute}>
            <Checkbox
              checked={draft.includes(attribute)}
              id={`scim-match-${attribute}`}
              onCheckedChange={(checked) =>
                toggleOptional(attribute, checked === true)
              }
            />
            <Label htmlFor={`scim-match-${attribute}`}>{attribute}</Label>
          </div>
        ))}
      </fieldset>

      <form className="space-y-4 rounded-md border p-4" onSubmit={save}>
        <h3 className="font-medium">{t("scim.match.stepUpTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.match.stepUpDescription")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scim-step-up-method">
              {t("scim.common.verificationMethod")}
            </Label>
            <Select
              onValueChange={(value) => {
                if (
                  value === "password" ||
                  value === "totp" ||
                  value === "backup_code"
                ) {
                  setAuthMethod(value);
                  setPassword("");
                  setCode("");
                }
              }}
              value={authMethod}
            >
              <SelectTrigger
                aria-label={t("scim.common.verificationMethod")}
                id="scim-step-up-method"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">
                  {t("scim.common.password")}
                </SelectItem>
                <SelectItem value="totp">
                  {t("scim.common.authenticatorCode")}
                </SelectItem>
                <SelectItem value="backup_code">
                  {t("scim.common.backupCode")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="scim-step-up-secret">
              {authMethod === "password"
                ? t("scim.common.password")
                : authMethod === "totp"
                  ? t("scim.common.authenticatorCode")
                  : t("scim.common.backupCode")}
            </Label>
            <Input
              autoComplete={
                authMethod === "password" ? "current-password" : "one-time-code"
              }
              id="scim-step-up-secret"
              onChange={(event) =>
                authMethod === "password"
                  ? setPassword(event.currentTarget.value)
                  : setCode(event.currentTarget.value)
              }
              type={authMethod === "password" ? "password" : "text"}
              value={authMethod === "password" ? password : code}
            />
          </div>
        </div>
        {saveError ? (
          <Alert variant="error">
            <AlertTitle>{t("scim.match.configurationNotSaved")}</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!changed || isSaving} type="submit">
            {isSaving ? t("scim.common.saving") : t("scim.match.save")}
          </Button>
          {canReloadSaveError ? (
            <Button
              disabled={isSaving}
              onClick={() => void refresh()}
              type="button"
              variant="outline"
            >
              {t("scim.common.reload")}
            </Button>
          ) : null}
          <span className="self-center text-sm text-muted-foreground">
            {t("scim.match.version", { version: settings.configVersion })}
          </span>
        </div>
      </form>

      {profileDraft ? (
        <form
          aria-labelledby="scim-profile-mapping-heading"
          className="space-y-4 rounded-md border p-4"
          onSubmit={saveProfileMapping}
        >
          <header className="space-y-1">
            <h3 className="font-medium" id="scim-profile-mapping-heading">
              {t("scim.match.profileTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("scim.match.profileDescription")}
            </p>
          </header>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["name", t("scim.match.displayNameSource")],
                ["email", t("scim.match.contactEmailSource")],
                ["jobTitle", t("scim.match.jobTitleSource")],
                ["locale", t("scim.match.localeSource")],
              ] as const
            ).map(([field, label]) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`scim-profile-${field}`}>{label}</Label>
                <Select
                  disabled={isSaving}
                  onValueChange={(value) =>
                    setProfileDraft((current) =>
                      current
                        ? {
                            ...current,
                            [field]: value,
                          }
                        : current,
                    )
                  }
                  value={profileDraft[field]}
                >
                  <SelectTrigger
                    aria-label={label}
                    id={`scim-profile-${field}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROFILE_MAPPING_OPTIONS[field].map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!profileChanged || isSaving} type="submit">
              {isSaving ? t("scim.common.saving") : t("scim.match.saveProfile")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("scim.match.noRawData")}
            </span>
          </div>
        </form>
      ) : null}

      <ScimTokenSettings
        configVersion={settings.configVersion}
        connectionId={connectionId}
        enabled={settings.data.enabled}
        onConfigurationChanged={recordTokenMutation}
        onReload={() => void refresh()}
      />
    </section>
  );
}

export const scimMatchAttributeContract = {
  required: REQUIRED_MATCH_ATTRIBUTES,
  optional: OPTIONAL_MATCH_ATTRIBUTES,
} as const;
