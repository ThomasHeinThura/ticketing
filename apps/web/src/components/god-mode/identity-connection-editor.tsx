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
import { useEffect, useState } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { routes } from "@/lib/routes";

type Connection = {
  id: string;
  portalScope: "agent" | "customer";
  organisationId: string | null;
  defaultWorkspaceId: string | null;
  displayName: string;
  tenantId: string | null;
  clientId: string;
  clientSecretConfigured: boolean;
  scopes: string[];
  claimMapping: { version: 1; displayName: "name" } | null;
  domainBindings: string[];
  jitPolicy: {
    enabled: boolean;
    default_role_id: string | null;
    required_entra_app_role: string;
  };
  maxRoleRank: number | null;
  enabled: boolean;
  configVersion: number;
};

type Draft = {
  portalScope: "agent" | "customer";
  organisationId: string;
  defaultWorkspaceId: string;
  displayName: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  domains: string;
  jitEnabled: boolean;
  defaultRoleId: string;
  requiredAppRole: string;
  maxRoleRank: string;
  enabled: boolean;
};

class RequestFailure extends Error {
  constructor(readonly status: number) {
    super("Identity connection request failed");
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

function emptyDraft(): Draft {
  return {
    portalScope: "agent",
    organisationId: "",
    defaultWorkspaceId: "",
    displayName: "",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    scopes: "openid, profile, email",
    domains: "",
    jitEnabled: false,
    defaultRoleId: "",
    requiredAppRole: "TaskDesk.User",
    maxRoleRank: "10",
    enabled: false,
  };
}

function draftFromConnection(connection: Connection): Draft {
  return {
    portalScope: connection.portalScope,
    organisationId: connection.organisationId ?? "",
    defaultWorkspaceId: connection.defaultWorkspaceId ?? "",
    displayName: connection.displayName,
    tenantId: connection.tenantId ?? "",
    clientId: connection.clientId,
    clientSecret: "",
    scopes: connection.scopes.join(", "),
    domains: connection.domainBindings.join("\n"),
    jitEnabled: connection.jitPolicy.enabled,
    defaultRoleId: connection.jitPolicy.default_role_id ?? "",
    requiredAppRole: connection.jitPolicy.required_entra_app_role,
    maxRoleRank: connection.maxRoleRank?.toString() ?? "",
    enabled: connection.enabled,
  };
}

function listValues(value: string) {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function IdentityConnectionEditor({
  connectionId,
}: {
  connectionId: string | null;
}) {
  const creating = connectionId === null;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(!creating);
  const [busy, setBusy] = useState(false);
  const [authMethod, setAuthMethod] = useState<
    "password" | "totp" | "backup_code"
  >("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (creating || !connectionId) return;
    let active = true;
    setLoading(true);
    void requestJson<{ data: Connection[] }>("instance/identity-connections")
      .then(({ data }) => {
        const found = data.find((item) => item.id === connectionId);
        if (!found) throw new Error("missing");
        if (!active) return;
        setConnection(found);
        setDraft(draftFromConnection(found));
        setError(null);
      })
      .catch(() => {
        if (active) setError("The identity connection could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, creating]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function requestBody() {
    const scopes = listValues(draft.scopes);
    const domainBindings = listValues(draft.domains).map((domain) =>
      domain.toLowerCase(),
    );
    const jitPolicy = {
      enabled: draft.jitEnabled,
      default_role_id: draft.defaultRoleId.trim() || null,
      required_entra_app_role: draft.requiredAppRole.trim(),
    };
    const maxRoleRank = draft.maxRoleRank.trim()
      ? Number(draft.maxRoleRank)
      : null;
    if (creating) {
      return {
        portalScope: draft.portalScope,
        organisationId:
          draft.portalScope === "customer"
            ? draft.organisationId.trim() || null
            : null,
        defaultWorkspaceId:
          draft.portalScope === "agent"
            ? draft.defaultWorkspaceId.trim() || null
            : null,
        displayName: draft.displayName.trim(),
        tenantId: draft.tenantId.trim(),
        clientId: draft.clientId.trim(),
        clientSecret: draft.clientSecret,
        scopes,
        claimMapping: { version: 1 as const, displayName: "name" as const },
        domainBindings,
        jitPolicy,
        maxRoleRank,
      };
    }
    if (!connection) throw new Error("Connection is unavailable");
    return {
      configVersion: connection.configVersion,
      displayName: draft.displayName.trim(),
      clientId: draft.clientId.trim(),
      ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
      scopes,
      claimMapping: connection.claimMapping ?? {
        version: 1 as const,
        displayName: "name" as const,
      },
      domainBindings,
      defaultWorkspaceId:
        draft.portalScope === "agent"
          ? draft.defaultWorkspaceId.trim() || null
          : null,
      jitPolicy,
      maxRoleRank,
      enabled: draft.enabled,
    };
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!creating && !connection)) return;
    if (authMethod === "password" ? !password : !code) {
      setError("Enter the selected fresh authentication factor.");
      return;
    }
    setBusy(true);
    setError(null);
    const request = requestBody();
    const binding = creating
      ? {
          kind: "operation" as const,
          operation: "identity_connection_create" as const,
          request,
        }
      : {
          kind: "operation" as const,
          operation: "identity_connection_configure" as const,
          connectionId,
          request,
        };
    try {
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
      const response = await requestJson<{ data: Connection }>(
        creating
          ? "instance/identity-connections"
          : `instance/identity-connections/${encodeURIComponent(connectionId ?? "")}`,
        {
          method: creating ? "POST" : "PATCH",
          headers: { "x-taskdesk-step-up-token": proof.token },
          body: JSON.stringify(request),
        },
      );
      setConnection(response.data);
      setDraft(draftFromConnection(response.data));
      setSavedId(response.data.id);
      setPassword("");
      setCode("");
    } catch (cause) {
      const status = cause instanceof RequestFailure ? cause.status : 0;
      setError(
        status === 403
          ? "Fresh administrator verification was unavailable or did not match this exact change."
          : status === 404
            ? "The identity connection is no longer available."
            : status === 409
              ? "Settings changed in another session. Reload before retrying."
              : status === 422
                ? "The identity provider, target or role configuration is invalid."
                : "The identity connection could not be saved. Your settings remain in this form.",
      );
      setPassword("");
      setCode("");
    } finally {
      update("clientSecret", "");
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading identity connection…</p>;
  if (creating && savedId) {
    return (
      <section
        className="space-y-4"
        aria-labelledby="identity-connection-created-heading"
      >
        <Alert>
          <AlertTitle id="identity-connection-created-heading">
            Identity connection created
          </AlertTitle>
          <AlertDescription>
            The connection is disabled at version {connection?.configVersion}.
            Enable it only after its configuration is ready.
          </AlertDescription>
        </Alert>
        <Button
          render={
            <a
              href={routes.identityConnectionSettings.build({ id: savedId })}
            />
          }
        >
          Open connection settings
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="identity-connection-editor-heading"
      className="space-y-5"
    >
      <header className="space-y-1">
        <h2
          className="text-lg font-semibold"
          id="identity-connection-editor-heading"
        >
          {creating ? "Add Entra connection" : "Connection configuration"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connection changes require fresh administrator verification. Client
          credentials are encrypted at rest and never shown again.
        </p>
      </header>
      {error ? (
        <Alert variant="error">
          <AlertTitle>Identity connection not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {savedId ? (
        <Alert>
          <AlertTitle>Identity connection saved</AlertTitle>
          <AlertDescription>
            The connection is stored at version {connection?.configVersion}.{" "}
            <a href={routes.identityConnectionSettings.build({ id: savedId })}>
              Open its settings
            </a>
          </AlertDescription>
        </Alert>
      ) : null}
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => void save(event)}
      >
        <div className="grid gap-1 text-sm">
          <Label htmlFor="identity-connection-name">Connection name</Label>
          <Input
            id="identity-connection-name"
            required
            maxLength={128}
            value={draft.displayName}
            onChange={(event) => update("displayName", event.target.value)}
          />
        </div>
        <div className="grid gap-1 text-sm">
          <Label htmlFor="identity-connection-portal">Portal</Label>
          <Select
            value={draft.portalScope}
            disabled={!creating}
            onValueChange={(value) =>
              update("portalScope", value as Draft["portalScope"])
            }
          >
            <SelectTrigger id="identity-connection-portal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Staff portal</SelectItem>
              <SelectItem value="customer">Customer portal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.portalScope === "customer" ? (
          <div className="grid gap-1 text-sm">
            <Label htmlFor="identity-connection-organisation">
              Organisation ID
            </Label>
            <Input
              id="identity-connection-organisation"
              required
              disabled={!creating}
              value={draft.organisationId}
              onChange={(event) => update("organisationId", event.target.value)}
            />
          </div>
        ) : (
          <div className="grid gap-1 text-sm">
            <Label htmlFor="identity-connection-workspace">
              Default internal workspace ID
            </Label>
            <Input
              id="identity-connection-workspace"
              value={draft.defaultWorkspaceId}
              onChange={(event) =>
                update("defaultWorkspaceId", event.target.value)
              }
            />
          </div>
        )}
        <div className="grid gap-1 text-sm">
          <Label htmlFor="identity-connection-tenant">Entra tenant ID</Label>
          <Input
            id="identity-connection-tenant"
            required
            disabled={!creating}
            value={draft.tenantId}
            onChange={(event) => update("tenantId", event.target.value)}
          />
        </div>
        <div className="grid gap-1 text-sm">
          <Label htmlFor="identity-connection-client">
            Application client ID
          </Label>
          <Input
            id="identity-connection-client"
            required
            value={draft.clientId}
            onChange={(event) => update("clientId", event.target.value)}
          />
        </div>
        <div className="grid gap-1 text-sm">
          <Label htmlFor="identity-connection-secret">
            {creating || !connection?.clientSecretConfigured
              ? "Client secret"
              : "Replace client secret (optional)"}
          </Label>
          <Input
            id="identity-connection-secret"
            type="password"
            autoComplete="new-password"
            required={creating}
            value={draft.clientSecret}
            onChange={(event) => update("clientSecret", event.target.value)}
          />
        </div>
        <div className="grid gap-1 text-sm md:col-span-2">
          <Label htmlFor="identity-connection-scopes">
            Requested OIDC scopes (comma or newline separated)
          </Label>
          <Input
            id="identity-connection-scopes"
            value={draft.scopes}
            onChange={(event) => update("scopes", event.target.value)}
          />
        </div>
        <div className="grid gap-1 text-sm md:col-span-2">
          <Label htmlFor="identity-connection-domains">
            Allowed email domains (one per line)
          </Label>
          <Input
            id="identity-connection-domains"
            value={draft.domains}
            onChange={(event) => update("domains", event.target.value)}
          />
        </div>
        <fieldset className="grid gap-3 rounded-md border p-4 md:col-span-2">
          <legend className="px-1 text-sm font-medium">
            Just-in-time access
          </legend>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Enable JIT provisioning"
              checked={draft.jitEnabled}
              onCheckedChange={(checked) =>
                update("jitEnabled", checked === true)
              }
            />
            Enable JIT provisioning
          </div>
          <div className="grid gap-1 text-sm">
            <Label htmlFor="identity-connection-role">
              Default role ID (optional while JIT is disabled)
            </Label>
            <Input
              id="identity-connection-role"
              value={draft.defaultRoleId}
              onChange={(event) => update("defaultRoleId", event.target.value)}
            />
          </div>
          <div className="grid gap-1 text-sm">
            <Label htmlFor="identity-connection-app-role">
              Required Entra application role
            </Label>
            <Input
              id="identity-connection-app-role"
              required
              value={draft.requiredAppRole}
              onChange={(event) =>
                update("requiredAppRole", event.target.value)
              }
            />
          </div>
          {draft.portalScope === "agent" ? (
            <div className="grid gap-1 text-sm">
              <Label htmlFor="identity-connection-max-rank">
                Maximum role rank
              </Label>
              <Input
                id="identity-connection-max-rank"
                required
                type="number"
                min={0}
                max={10000}
                value={draft.maxRoleRank}
                onChange={(event) => update("maxRoleRank", event.target.value)}
              />
            </div>
          ) : null}
        </fieldset>
        {!creating ? (
          <div className="flex items-center gap-2 text-sm md:col-span-2">
            <Checkbox
              aria-label="Enable this connection"
              checked={draft.enabled}
              onCheckedChange={(checked) => update("enabled", checked === true)}
            />
            Enable this connection
          </div>
        ) : null}
        <fieldset className="grid gap-3 rounded-md border p-4 md:col-span-2">
          <legend className="px-1 text-sm font-medium">
            Confirm this change
          </legend>
          <Label htmlFor="identity-connection-auth-method">
            Fresh authentication method
          </Label>
          <Select
            value={authMethod}
            onValueChange={(value) => setAuthMethod(value as typeof authMethod)}
          >
            <SelectTrigger id="identity-connection-auth-method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="totp">Authenticator code</SelectItem>
              <SelectItem value="backup_code">Backup code</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor="identity-connection-auth-value">
            Fresh authentication
          </Label>
          <Input
            id="identity-connection-auth-value"
            type={authMethod === "password" ? "password" : "text"}
            autoComplete="off"
            inputMode={authMethod === "password" ? undefined : "numeric"}
            value={authMethod === "password" ? password : code}
            onChange={(event) =>
              authMethod === "password"
                ? setPassword(event.target.value)
                : setCode(event.target.value)
            }
          />
        </fieldset>
        <div className="flex gap-2 md:col-span-2">
          <Button
            type="submit"
            disabled={busy || loading || (!creating && !connection)}
          >
            {busy
              ? "Saving…"
              : creating
                ? "Create disabled connection"
                : "Save and apply settings"}
          </Button>
          {!creating && connection ? (
            <span className="self-center text-sm text-muted-foreground">
              Configuration version {connection.configVersion}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
