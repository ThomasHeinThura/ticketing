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
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("identityConnections");
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
  const [canReloadSaveError, setCanReloadSaveError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  function reloadLatest() {
    setOptions(null);
    setTargets([]);
    setLoadError(null);
    setOptionsReloadKey((current) => current + 1);
    onReload();
  }

  // The retry counter intentionally restarts this request after its URL is unchanged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry counter is the fetch trigger
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
        if (active) setLoadError(t("scim.group.loadFailed"));
      });
    return () => {
      active = false;
    };
  }, [optionsPath, optionsReloadKey, t]);

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
          setLoadError(t("scim.group.rolesLoadFailed"));
        }
      })
      .finally(() => {
        if (active) setIsLoadingRoles(false);
      });
    return () => {
      active = false;
    };
  }, [draft.scopeId, options?.kind, optionsPath, t]);

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
    setCanReloadSaveError(false);
  }

  function resetDraft() {
    setDraft(emptyDraft());
    setEditingId(null);
    setPassword("");
    setCode("");
    setSaveError(null);
    setCanReloadSaveError(false);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (options?.kind !== "agent_targets" && options?.kind !== "customer")
      return;
    const selectedRole = customer?.role?.id ?? draft.roleId;
    const selectedScope = customer ? "organisation" : "workspace";
    const selectedScopeId = customer?.target?.id ?? draft.scopeId;
    if (!selectedRole || !selectedScopeId) {
      setSaveError(t("scim.group.errors.targetRequired"));
      return;
    }
    if (!editingId && !draft.externalGroupId.trim()) {
      setSaveError(t("scim.group.errors.externalIdRequired"));
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
      setSaveError(t("scim.group.errors.factorRequired"));
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
      await requestJson<SafeSettings>(basePath, {
        method: "PATCH",
        headers: { "x-taskdesk-step-up-token": proof.token },
        body: JSON.stringify(request),
      });
      resetDraft();
      onReload();
    } catch (error) {
      if (error instanceof RequestFailure && error.status === 409) {
        setSaveError(
          error.title.toLowerCase().includes("duplicate")
            ? t("scim.group.errors.duplicate")
            : t("scim.group.errors.stale"),
        );
        setCanReloadSaveError(true);
      } else if (error instanceof RequestFailure && error.status === 422) {
        setSaveError(t("scim.group.errors.ineligible"));
        setCanReloadSaveError(true);
      } else {
        setSaveError(t("scim.group.errors.saveFailed"));
      }
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
          {t("scim.group.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.group.description")}
        </p>
      </header>
      {loadError ? (
        <Alert variant="error">
          <AlertTitle>{t("scim.group.loadUnavailable")}</AlertTitle>
          <AlertDescription>
            {loadError}
            <Button onClick={reloadLatest} type="button" variant="outline">
              {t("scim.group.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!loadError && options === null ? (
        <p role="status">{t("scim.group.loading")}</p>
      ) : null}
      {options?.kind === "customer" && (!options.target || !options.role) ? (
        <p role="status">{t("scim.group.customerUnavailable")}</p>
      ) : null}
      {mappings.length ? (
        <ul aria-label={t("scim.group.listLabel")} className="space-y-2">
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
                  {mapping.externalGroupId} · {t("scim.group.roleLabel")}{" "}
                  {mapping.roleId} ·{" "}
                  {mapping.enabled
                    ? t("scim.group.enabled")
                    : t("scim.group.disabled")}
                </p>
              </div>
              <Button
                disabled={isSaving}
                onClick={() => edit(mapping)}
                type="button"
                variant="outline"
              >
                {t("scim.group.editAction")}
              </Button>
            </li>
          ))}
        </ul>
      ) : options ? (
        <p>{t("scim.group.empty")}</p>
      ) : null}
      {options &&
      (options.kind !== "customer" || (options.target && options.role)) ? (
        <form className="space-y-4 rounded-md border p-4" onSubmit={save}>
          <h4 className="font-medium">
            {editingId ? t("scim.group.editTitle") : t("scim.group.addTitle")}
          </h4>
          {!editingId ? (
            <div className="space-y-2">
              <Label htmlFor="scim-map-external-id">
                {t("scim.group.externalId")}
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
              {t("scim.group.externalId")}: {draft.externalGroupId}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="scim-map-display-name">
              {t("scim.group.displayName")}
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
              <Label htmlFor="scim-map-target">
                {t("scim.group.workspace")}
              </Label>
              <Select
                onValueChange={(value) =>
                  setDraft((v) => ({ ...v, scopeId: value ?? "", roleId: "" }))
                }
                value={draft.scopeId}
              >
                <SelectTrigger id="scim-map-target">
                  <SelectValue placeholder={t("scim.group.chooseWorkspace")} />
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
              {t("scim.group.customerOrganisation", {
                target: customer?.target?.name,
                role: customer?.role?.name,
              })}
            </p>
          )}
          {options.kind === "agent_targets" ? (
            <div className="space-y-2">
              <Label htmlFor="scim-map-role">
                {t("scim.group.eligibleRole")}
              </Label>
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
                        ? t("scim.group.loadingRoles")
                        : t("scim.group.chooseRole")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name} · {t("scim.group.rank", { rank: role.rank })}
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
              <Label htmlFor="scim-map-enabled">
                {t("scim.group.mappingEnabled")}
              </Label>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="scim-map-proof-method">
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
              <SelectTrigger id="scim-map-proof-method">
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
            <Label htmlFor="scim-map-proof">
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
              <AlertTitle>{t("scim.group.notSaved")}</AlertTitle>
              <AlertDescription>
                {saveError}
                {canReloadSaveError ? (
                  <Button
                    onClick={() => {
                      resetDraft();
                      reloadLatest();
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t("scim.common.reload")}
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
                ? t("scim.common.saving")
                : editingId
                  ? t("scim.group.save")
                  : t("scim.group.create")}
            </Button>
            {editingId ? (
              <Button
                disabled={isSaving}
                onClick={resetDraft}
                type="button"
                variant="outline"
              >
                {t("scim.group.cancel")}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
