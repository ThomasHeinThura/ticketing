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
import { getApiUrl } from "@/fetchers/get-api-url";
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

function errorText(error: unknown, operation: "load" | "save") {
  if (error instanceof RequestFailure) {
    if (error.status === 403)
      return "Your administrator session could not authorize this request. Sign in again or contact an instance administrator.";
    if (error.status === 404)
      return "This connection does not have a SCIM configuration yet, or it is no longer available.";
    if (error.status === 409)
      return "SCIM settings changed in another session. Your draft is still here; reload the latest version before saving again.";
    if (error.status === 422)
      return "The SCIM settings were rejected. Review the selected attributes and try again.";
    if (error.status === 503)
      return "Stored SCIM settings are unavailable until the configuration is repaired.";
  }
  return operation === "load"
    ? "SCIM settings could not be loaded. Check access and try again."
    : "SCIM settings could not be saved. Try again.";
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
  const [settings, setSettings] = useState<ScimSettingsResponse | null>(null);
  const [draft, setDraft] = useState<MatchAttribute[]>([]);
  const [groupsAllowed, setGroupsAllowed] = useState(false);
  const [lifecycleDraft, setLifecycleDraft] =
    useState<LifecyclePolicy>("end_memberships");
  const [profileDraft, setProfileDraft] = useState<ProfileMapping | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    try {
      const response = await requestJson<ScimSettingsResponse>(apiPath);
      setSettings(response);
      setDraft([...response.data.matchAttributes]);
      setGroupsAllowed(response.data.allowedResources.includes("groups"));
      setLifecycleDraft(response.data.lifecyclePolicy);
      setProfileDraft({ ...response.data.attributeMapping });
      setSaveError(null);
    } catch (error) {
      setLoadError(errorText(error, "load"));
      setSettings(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiPath]);

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
          ? "Enter your password to confirm this change."
          : "Enter a fresh authenticator or backup code to confirm this change.",
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
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
      setSaveError(errorText(error, "save"));
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
          ? "Enter your password to confirm this change."
          : "Enter a fresh authenticator or backup code to confirm this change.",
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
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
      setSaveError(errorText(error, "save"));
      setPassword("");
      setCode("");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <p role="status">Loading SCIM settings…</p>;
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <AlertTitle>SCIM settings unavailable</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Button onClick={() => void refresh()}>Retry</Button>
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
          SCIM configuration
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure this connection’s available SCIM resources, deactivation
          behavior, and supported user lookup attributes. These settings do not
          change identity linking or authority.
        </p>
      </header>

      <fieldset className="space-y-3" disabled={isSaving}>
        <legend className="font-medium">Provisioned resources</legend>
        <div className="flex items-start gap-3">
          <Checkbox checked disabled id="scim-resource-users" />
          <div className="space-y-0.5">
            <Label htmlFor="scim-resource-users">Users</Label>
            <p className="text-sm text-muted-foreground">
              Required by the SCIM connection.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={groupsAllowed}
            id="scim-resource-groups"
            onCheckedChange={(checked) => setGroupsAllowed(checked === true)}
          />
          <Label htmlFor="scim-resource-groups">Groups</Label>
        </div>
      </fieldset>

      <div className="max-w-md space-y-2">
        <Label htmlFor="scim-lifecycle-policy">User deactivation policy</Label>
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
            aria-label="User deactivation policy"
            id="scim-lifecycle-policy"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="end_memberships">
              End sourced memberships
            </SelectItem>
            <SelectItem value="keep_memberships">
              Keep sourced memberships
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          This controls future SCIM user deactivation only.
        </p>
      </div>

      <fieldset className="space-y-3" disabled={isSaving}>
        <legend className="font-medium">Supported match attributes</legend>
        {REQUIRED_MATCH_ATTRIBUTES.map((attribute) => (
          <div className="flex items-start gap-3" key={attribute}>
            <Checkbox checked disabled id={`scim-match-${attribute}`} />
            <div className="space-y-0.5">
              <Label htmlFor={`scim-match-${attribute}`}>{attribute}</Label>
              <p className="text-sm text-muted-foreground">
                Required for every SCIM connection.
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
        <h3 className="font-medium">Confirm with step-up authentication</h3>
        <p className="text-sm text-muted-foreground">
          Saving requires a fresh, session-bound confirmation. The confirmation
          is bound to these exact settings and their current version.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scim-step-up-method">Verification method</Label>
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
                aria-label="Verification method"
                id="scim-step-up-method"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="totp">Authenticator code</SelectItem>
                <SelectItem value="backup_code">Backup code</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="scim-step-up-secret">
              {authMethod === "password"
                ? "Password"
                : authMethod === "totp"
                  ? "Authenticator code"
                  : "Backup code"}
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
            <AlertTitle>SCIM configuration was not saved</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!changed || isSaving} type="submit">
            {isSaving ? "Saving…" : "Save SCIM settings"}
          </Button>
          {saveError?.includes("changed in another session") ? (
            <Button
              disabled={isSaving}
              onClick={() => void refresh()}
              type="button"
              variant="outline"
            >
              Reload latest settings
            </Button>
          ) : null}
          <span className="self-center text-sm text-muted-foreground">
            Configuration version {settings.configVersion}
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
              SCIM profile attribute mapping
            </h3>
            <p className="text-sm text-muted-foreground">
              Choose fixed SCIM profile fields for TaskDesk profile data.
              Changes affect future authenticated SCIM user writes only; they do
              not alter identity matching, account linking, or authority.
            </p>
          </header>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["name", "Display name source"],
                ["email", "Contact email source"],
                ["jobTitle", "Job title source"],
                ["locale", "Locale source"],
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
              {isSaving ? "Saving…" : "Save profile mapping"}
            </Button>
            <span className="text-sm text-muted-foreground">
              No raw SCIM profile data is stored in this mapping.
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
