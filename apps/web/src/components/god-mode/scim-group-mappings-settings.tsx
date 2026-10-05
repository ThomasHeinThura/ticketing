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

type Mapping = {
  id: string;
  externalGroupId: string;
  externalGroupNameSnapshot: string | null;
  roleId: string;
  scope: "organisation" | "workspace";
  scopeId: string;
  enabled: boolean;
};
type Target = { id: string; name: string };
type Role = { id: string; name: string; rank: number };
type MappingOptions =
  | { kind: "agent_targets"; data: Target[]; nextCursor: string | null }
  | {
      kind: "agent_roles";
      target: Target;
      data: Role[];
      nextCursor: string | null;
    }
  | {
      kind: "customer";
      target: Target | null;
      role: Role | null;
      nextCursor: null;
    };
type AgentOptions = Extract<
  MappingOptions,
  { kind: "agent_targets" | "agent_roles" }
>;
type SafeSettings = {
  data: { mappings: Mapping[] };
  configVersion: number;
};
type Draft = {
  externalGroupId: string;
  externalGroupNameSnapshot: string;
  roleId: string;
  scopeId: string;
  enabled: boolean;
};

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
  ) {
    super("SCIM mapping request failed");
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let title = "Request failed";
    try {
      const body = (await response.json()) as { title?: unknown };
      if (typeof body.title === "string") title = body.title;
    } catch {
      // Keep the generic message when the server returned no problem document.
    }
    throw new RequestFailure(response.status, title);
  }
  return (await response.json()) as T;
}

async function readAllPages(
  path: string,
  initial: URLSearchParams,
  expectedKind: AgentOptions["kind"],
  initialPage?: AgentOptions,
): Promise<AgentOptions> {
  let cursor = initialPage?.nextCursor ?? null;
  let first = initialPage ?? null;
  const seenCursors = new Set<string>(cursor ? [cursor] : []);
  while (!first || cursor) {
    const query = new URLSearchParams(initial);
    query.set("limit", "100");
    if (cursor) query.set("cursor", cursor);
    const page = await requestJson<AgentOptions>(`${path}?${query}`);
    if (page.kind !== expectedKind)
      throw new Error("The server returned an unexpected selector result.");
    if (!first) first = page;
    else if (page.kind === "agent_targets" && first.kind === "agent_targets")
      first = { ...first, data: [...first.data, ...page.data] };
    else if (page.kind === "agent_roles" && first.kind === "agent_roles")
      first = { ...first, data: [...first.data, ...page.data] };
    else throw new Error("The selector changed result type between pages.");
    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor))
        throw new Error("The selector returned a repeated page cursor.");
      seenCursors.add(cursor);
    }
  }
  if (!first) throw new Error("The selector returned no page.");
  return { ...first, nextCursor: null };
}

async function readTargetOptions(path: string): Promise<MappingOptions> {
  const initial = new URLSearchParams({ limit: "100" });
  const first = await requestJson<MappingOptions>(`${path}?${initial}`);
  if (first.kind === "customer") return first;
  if (first.kind !== "agent_targets")
    throw new Error("The server returned an unexpected selector result.");
  return readAllPages(path, new URLSearchParams(), "agent_targets", first);
}

function emptyDraft(): Draft {
  return {
    externalGroupId: "",
    externalGroupNameSnapshot: "",
    roleId: "",
    scopeId: "",
    enabled: true,
  };
}

export function ScimGroupMappingsSettings({
  connectionId,
  configVersion,
  mappings,
  onReload,
}: {
  connectionId: string;
  configVersion: number;
  mappings: Mapping[];
  onReload: () => void;
}) {
  const basePath = `instance/identity-connections/${encodeURIComponent(connectionId)}/scim`;
  const optionsPath = `${basePath}/mapping-options`;
  const [options, setOptions] = useState<MappingOptions | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<
    "password" | "totp" | "backup_code"
  >("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);

  useEffect(() => {
    let active = true;
    void readTargetOptions(optionsPath)
      .then((result) => {
        if (!active) return;
        setOptions(result);
        setTargets(result.kind === "agent_targets" ? result.data : []);
        setLoadError(null);
      })
      .catch(() => {
        if (active)
          setLoadError("Eligible SCIM mapping targets could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [optionsPath]);

  useEffect(() => {
    if (!draft.scopeId || options?.kind !== "agent_targets") {
      setRoles([]);
      return;
    }
    let active = true;
    setIsLoadingRoles(true);
    const query = new URLSearchParams({ workspaceId: draft.scopeId });
    void readAllPages(optionsPath, query, "agent_roles")
      .then((result) => {
        if (!active) return;
        setRoles(result.kind === "agent_roles" ? result.data : []);
      })
      .catch(() => {
        if (active) {
          setRoles([]);
          setLoadError(
            "Eligible roles for this workspace could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingRoles(false);
      });
    return () => {
      active = false;
    };
  }, [draft.scopeId, options?.kind, optionsPath]);

  const customer = options?.kind === "customer" ? options : null;
  function edit(mapping: Mapping) {
    setEditingId(mapping.id);
    setDraft({
      externalGroupId: mapping.externalGroupId,
      externalGroupNameSnapshot: mapping.externalGroupNameSnapshot ?? "",
      roleId: mapping.roleId,
      scopeId: mapping.scopeId,
      enabled: mapping.enabled,
    });
    setSaveError(null);
  }

  function resetDraft() {
    setDraft(emptyDraft());
    setEditingId(null);
    setPassword("");
    setCode("");
    setSaveError(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (options?.kind !== "agent_targets" && options?.kind !== "customer")
      return;
    const selectedRole = customer?.role?.id ?? draft.roleId;
    const selectedScope = customer ? "organisation" : "workspace";
    const selectedScopeId = customer?.target?.id ?? draft.scopeId;
    if (!selectedRole || !selectedScopeId) {
      setSaveError("Choose an eligible target and role before saving.");
      return;
    }
    if (!editingId && !draft.externalGroupId.trim()) {
      setSaveError("Enter the provider's external group identifier.");
      return;
    }
    const request = editingId
      ? {
          configVersion,
          kind: "mapping_update" as const,
          mappingId: editingId,
          externalGroupNameSnapshot:
            draft.externalGroupNameSnapshot.trim() || null,
          roleId: selectedRole,
          ...(customer ? {} : { scopeId: selectedScopeId }),
          enabled: draft.enabled,
        }
      : {
          configVersion,
          kind: "mapping_create" as const,
          externalGroupId: draft.externalGroupId.trim(),
          externalGroupNameSnapshot:
            draft.externalGroupNameSnapshot.trim() || null,
          roleId: selectedRole,
          scope: selectedScope,
          ...(customer ? {} : { scopeId: selectedScopeId }),
          enabled: draft.enabled,
        };
    if (authMethod === "password" ? !password : !code) {
      setSaveError("Enter the selected fresh authentication factor.");
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
      await requestJson<SafeSettings>(basePath, {
        method: "PATCH",
        headers: { "x-taskdesk-step-up-token": proof.token },
        body: JSON.stringify(request),
      });
      resetDraft();
      onReload();
    } catch (error) {
      if (error instanceof RequestFailure && error.status === 409)
        setSaveError(
          error.title.toLowerCase().includes("duplicate")
            ? "That external group is already mapped for this connection."
            : "SCIM settings changed in another session. Your draft is preserved; reload before retrying.",
        );
      else if (error instanceof RequestFailure && error.status === 422)
        setSaveError(
          "The selected group mapping is no longer eligible. Reload the options and try again.",
        );
      else
        setSaveError(
          "The group mapping was not saved. Your draft is preserved; verify the latest settings and try again.",
        );
      setPassword("");
      setCode("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="scim-group-mappings-heading"
      className="space-y-4"
    >
      <header className="space-y-1">
        <h3 className="font-semibold" id="scim-group-mappings-heading">
          SCIM group mappings
        </h3>
        <p className="text-sm text-muted-foreground">
          Map a provider group to one existing eligible role. Changes use the
          connection's current version and are confirmed individually.
        </p>
      </header>
      {loadError ? (
        <Alert variant="error">
          <AlertTitle>Mapping options unavailable</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {!loadError && options === null ? (
        <p role="status">Loading eligible mapping options…</p>
      ) : null}
      {options?.kind === "customer" && (!options.target || !options.role) ? (
        <p role="status">
          No eligible customer mapping target and role are available for this
          connection.
        </p>
      ) : null}
      {mappings.length ? (
        <ul aria-label="Configured SCIM group mappings" className="space-y-2">
          {mappings.map((mapping) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              key={mapping.id}
            >
              <div>
                <p className="font-medium">
                  {mapping.externalGroupNameSnapshot || mapping.externalGroupId}
                </p>
                <p className="text-sm text-muted-foreground">
                  {mapping.externalGroupId} · role {mapping.roleId} ·{" "}
                  {mapping.enabled ? "enabled" : "disabled"}
                </p>
              </div>
              <Button
                disabled={isSaving}
                onClick={() => edit(mapping)}
                type="button"
                variant="outline"
              >
                Edit mapping
              </Button>
            </li>
          ))}
        </ul>
      ) : options ? (
        <p>No SCIM group mappings are configured.</p>
      ) : null}
      {options &&
      (options.kind !== "customer" || (options.target && options.role)) ? (
        <form className="space-y-4 rounded-md border p-4" onSubmit={save}>
          <h4 className="font-medium">
            {editingId ? "Edit group mapping" : "Add group mapping"}
          </h4>
          {!editingId ? (
            <div className="space-y-2">
              <Label htmlFor="scim-map-external-id">
                External group identifier
              </Label>
              <Input
                id="scim-map-external-id"
                maxLength={255}
                onChange={(e) => {
                  const externalGroupId = e.currentTarget.value;
                  setDraft((v) => ({ ...v, externalGroupId }));
                }}
                value={draft.externalGroupId}
              />
            </div>
          ) : (
            <p className="text-sm">
              External group identifier: {draft.externalGroupId}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="scim-map-display-name">
              Display name (optional)
            </Label>
            <Input
              id="scim-map-display-name"
              maxLength={255}
              onChange={(e) => {
                const externalGroupNameSnapshot = e.currentTarget.value;
                setDraft((v) => ({ ...v, externalGroupNameSnapshot }));
              }}
              value={draft.externalGroupNameSnapshot}
            />
          </div>
          {options.kind === "agent_targets" ? (
            <div className="space-y-2">
              <Label htmlFor="scim-map-target">Internal workspace</Label>
              <Select
                onValueChange={(value) =>
                  setDraft((v) => ({ ...v, scopeId: value ?? "", roleId: "" }))
                }
                value={draft.scopeId}
              >
                <SelectTrigger id="scim-map-target">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm">
              Customer organisation: {customer?.target?.name}; role:{" "}
              {customer?.role?.name}
            </p>
          )}
          {options.kind === "agent_targets" ? (
            <div className="space-y-2">
              <Label htmlFor="scim-map-role">Eligible role</Label>
              <Select
                disabled={!draft.scopeId || isLoadingRoles}
                onValueChange={(value) =>
                  setDraft((v) => ({ ...v, roleId: value ?? "" }))
                }
                value={draft.roleId}
              >
                <SelectTrigger id="scim-map-role">
                  <SelectValue
                    placeholder={
                      isLoadingRoles
                        ? "Loading eligible roles"
                        : "Choose a role"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name} · rank {role.rank}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {editingId ? (
            <div className="flex items-start gap-3">
              <Checkbox
                checked={draft.enabled}
                id="scim-map-enabled"
                onCheckedChange={(checked) =>
                  setDraft((v) => ({ ...v, enabled: checked === true }))
                }
              />
              <Label htmlFor="scim-map-enabled">Mapping enabled</Label>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="scim-map-proof-method">Verification method</Label>
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
              <SelectTrigger id="scim-map-proof-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="totp">Authenticator code</SelectItem>
                <SelectItem value="backup_code">Backup code</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="scim-map-proof">
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
              id="scim-map-proof"
              onChange={(e) =>
                authMethod === "password"
                  ? setPassword(e.currentTarget.value)
                  : setCode(e.currentTarget.value)
              }
              type={authMethod === "password" ? "password" : "text"}
              value={authMethod === "password" ? password : code}
            />
          </div>
          {saveError ? (
            <Alert variant="error">
              <AlertTitle>Mapping was not saved</AlertTitle>
              <AlertDescription>
                {saveError}
                {saveError.includes("reload") ? (
                  <Button
                    onClick={() => {
                      resetDraft();
                      onReload();
                    }}
                    type="button"
                    variant="outline"
                  >
                    Reload latest settings
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={
                isSaving ||
                isLoadingRoles ||
                (options.kind === "agent_targets" &&
                  (!draft.scopeId || !draft.roleId))
              }
              type="submit"
            >
              {isSaving
                ? "Saving…"
                : editingId
                  ? "Save mapping"
                  : "Create mapping"}
            </Button>
            {editingId ? (
              <Button
                disabled={isSaving}
                onClick={resetDraft}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
