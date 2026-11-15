import { canonicalEntraGroupObjectId } from "@taskdesk/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Input,
  Label,
  SaveButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useDelayedPending,
} from "@taskdesk/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import type {
  OidcGroupMappingCreateInput,
  OidcGroupMappingListResponse,
  OidcGroupMappingRow,
  OidcGroupMappingUpdateInput,
  ScimMappingOptions,
} from "@/fetchers/god-mode/identity-connections";
import { useIdentityConnectionMutations } from "@/hooks/mutations/god-mode/use-identity-connection-mutations";
import {
  useOidcGroupMappings,
  useOidcMappingOptions,
} from "@/hooks/queries/god-mode/use-identity-connections";
import { useServerDraft } from "@/hooks/use-server-draft";
import type { StepUpAction } from "@/hooks/use-step-up-action";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import {
  buildOidcMappingRequest,
  draftFromMapping,
  emptyMappingDraft,
  isValidDisplaySnapshot,
} from "@/lib/identity-connection-form";
import { toast } from "@/lib/toast";
import { FailureAlert, StepUpFields } from "./step-up-fields";

type Props = {
  connectionId: string;
  settings: OidcGroupMappingListResponse;
  /** `new`, a mapping id, or undefined when the form is closed (URL state). */
  openMapping: string | undefined;
  onOpenMapping: (mapping: string | undefined) => void;
  step: StepUpAction;
  onReload: () => void;
  run: (
    request: OidcGroupMappingCreateInput | OidcGroupMappingUpdateInput,
    mappingId?: string,
  ) => Promise<boolean>;
};

function isKind<K extends ScimMappingOptions["kind"]>(
  options: ScimMappingOptions,
  kind: K,
): options is Extract<ScimMappingOptions, { kind: K }> {
  return options.kind === kind;
}

/** Both the read and the form-open state of group mappings are explicit; nothing here deletes a mapping. */
function OidcMappingsLoaded(props: Props) {
  const { t } = useTranslation("identityConnections");
  const { settings, openMapping, onOpenMapping, step } = props;
  const mappings = settings.data;
  const existing =
    openMapping && openMapping !== "new"
      ? (mappings.find((mapping) => mapping.id === openMapping) ?? null)
      : null;

  return (
    <section aria-labelledby="oidc-groups-heading" className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-semibold" id="oidc-groups-heading">
          {t("oidcGroups.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("oidcGroups.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("editor.facts.versionValue", { version: settings.configVersion })}
        </p>
      </header>
      {mappings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("scim.groups.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("oidcGroups.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label={t("scim.groups.listLabel")} className="space-y-2">
          {mappings.map((mapping) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              key={mapping.id}
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {mapping.externalGroupNameSnapshot || mapping.externalGroupId}
                </p>
                <p className="break-all text-sm text-muted-foreground">
                  {mapping.externalGroupId} · {t("scim.groups.role")}{" "}
                  {mapping.roleId} ·{" "}
                  {mapping.scope === "workspace"
                    ? t("scim.groups.workspace")
                    : t("oidcGroups.organisation")}
                  : {mapping.scopeId} · {mapping.updatedAt}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={mapping.enabled ? "success" : "outline"}>
                  {mapping.enabled
                    ? t("scim.groups.enabled")
                    : t("scim.groups.disabled")}
                </Badge>
                <Button
                  disabled={step.busy}
                  onClick={() => onOpenMapping(mapping.id)}
                  type="button"
                  variant="outline"
                >
                  {t("scim.groups.edit")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {openMapping === undefined ? (
        <div className="space-y-2">
          <Button
            disabled={step.busy}
            onClick={() => onOpenMapping("new")}
            type="button"
          >
            {t("scim.groups.add")}
          </Button>
        </div>
      ) : openMapping !== "new" && existing === null ? (
        <Alert variant="warning">
          <AlertTitle>{t("scim.groups.missingTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("scim.groups.missing")}</p>
            <Button
              onClick={() => onOpenMapping(undefined)}
              type="button"
              variant="outline"
            >
              {t("scim.groups.close")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <MappingForm
          // A different mapping (or the add form) is a different draft.
          key={openMapping}
          {...props}
          existing={existing}
        />
      )}
    </section>
  );
}

function MappingForm({
  connectionId,
  settings,
  step,
  run,
  onOpenMapping,
  existing,
  onReload,
}: Props & { existing: OidcGroupMappingRow | null }) {
  const { t } = useTranslation("identityConnections");
  const snapshot = useMemo(
    () => ({ mapping: existing, configVersion: settings.configVersion }),
    [existing, settings.configVersion],
  );
  const draftState = useServerDraft(snapshot, (value) =>
    value.mapping ? draftFromMapping(value.mapping) : emptyMappingDraft(),
  );
  const { draft, setDraft } = draftState;
  const baseVersion = draftState.base.configVersion;
  const [invalid, setInvalid] = useState<
    "externalId" | "snapshot" | "target" | null
  >(null);

  const targets = useOidcMappingOptions(connectionId, undefined, true);
  const targetData = targets.data;
  const agentTargets =
    targetData && isKind(targetData, "agent_targets") ? targetData : null;
  const customer =
    targetData && isKind(targetData, "customer") ? targetData : null;
  const roles = useOidcMappingOptions(
    connectionId,
    draft.scopeId || undefined,
    Boolean(agentTargets && draft.scopeId),
  );
  const roleData = roles.data;
  const agentRoles =
    roleData && isKind(roleData, "agent_roles") ? roleData.data : [];

  const roleId = customer
    ? existing
      ? draft.roleId
      : (customer.role?.id ?? "")
    : draft.roleId;
  const scopeId = customer
    ? existing
      ? draft.scopeId
      : (customer.target?.id ?? "")
    : draft.scopeId;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.busy) return;
    if (
      !existing &&
      !canonicalEntraGroupObjectId(draft.externalGroupId.trim())
    ) {
      setInvalid("externalId");
      return;
    }
    if (!isValidDisplaySnapshot(draft.displayName.trim())) {
      setInvalid("snapshot");
      return;
    }
    if (!roleId || !scopeId) {
      setInvalid("target");
      return;
    }
    setInvalid(null);
    const request = buildOidcMappingRequest({
      version: baseVersion,
      existing: draftState.base.mapping,
      customer: Boolean(customer),
      draft: {
        ...draft,
        roleId,
        scopeId,
        externalGroupId:
          canonicalEntraGroupObjectId(draft.externalGroupId.trim()) ?? "",
      },
    });
    if (!request) {
      onOpenMapping(undefined);
      return;
    }
    const ok = await run(request, existing?.id);
    if (ok) {
      toast.success(t("common:actions.saved"));
      onOpenMapping(undefined);
    }
  }

  const loadingOptions = targets.isPending;
  const optionsPlaceholder = useDelayedPending(loadingOptions, {
    releaseNow: targets.isSuccess && agentTargets?.data.length === 0,
  });
  const rolesPlaceholder = useDelayedPending(
    Boolean(draft.scopeId && roles.isPending),
    { releaseNow: roles.isSuccess && agentRoles.length === 0 },
  );
  return (
    <form
      aria-labelledby="oidc-mapping-form-heading"
      className="space-y-4 rounded-md border p-4"
      onSubmit={submit}
    >
      <h4 className="font-medium" id="oidc-mapping-form-heading">
        {existing ? t("scim.groups.editTitle") : t("scim.groups.addTitle")}
      </h4>
      {targets.isError ? (
        <Alert variant="error">
          <AlertTitle>{t("scim.groups.optionsUnavailable")}</AlertTitle>
          <AlertDescription>
            <p>{t("scim.groups.optionsFailed")}</p>
            <Button
              onClick={() => void targets.refetch()}
              type="button"
              variant="outline"
            >
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!targets.isError && (loadingOptions || optionsPlaceholder) ? (
        <p
          role="status"
          style={{ visibility: optionsPlaceholder ? "visible" : "hidden" }}
        >
          {t("scim.groups.optionsLoading")}
        </p>
      ) : null}
      {existing ? (
        <p className="break-all text-sm">
          {t("scim.groups.externalId")}: {existing.externalGroupId}
        </p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="oidc-map-external">
            {t("scim.groups.externalId")}
          </Label>
          <Input
            disabled={step.busy}
            id="oidc-map-external"
            onChange={(event) =>
              setDraft({ externalGroupId: event.currentTarget.value })
            }
            value={draft.externalGroupId}
          />
          <p className="text-xs text-muted-foreground">
            {t("oidcGroups.externalIdHelp")}
          </p>
          {invalid === "externalId" ? (
            <p className="text-xs text-destructive-foreground" role="alert">
              {t("oidcGroups.invalidExternalId")}
            </p>
          ) : null}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="oidc-map-name">{t("scim.groups.displayName")}</Label>
        <Input
          disabled={step.busy}
          id="oidc-map-name"
          onChange={(event) =>
            setDraft({ displayName: event.currentTarget.value })
          }
          value={draft.displayName}
        />
        <p className="text-xs text-muted-foreground">
          {t("scim.groups.displayNameHelp")}
        </p>
        {invalid === "snapshot" ? (
          <p className="text-xs text-destructive-foreground" role="alert">
            {t("scim.groups.errors.snapshot")}
          </p>
        ) : null}
      </div>
      {agentTargets ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="oidc-map-workspace">
              {t("scim.groups.workspace")}
            </Label>
            <Select
              items={agentTargets.data.map((target) => ({
                value: target.id,
                label: target.name,
              }))}
              disabled={step.busy}
              onValueChange={(value) =>
                setDraft({ scopeId: value ?? "", roleId: "" })
              }
              value={draft.scopeId}
            >
              <SelectTrigger id="oidc-map-workspace">
                <SelectValue placeholder={t("scim.groups.chooseWorkspace")} />
              </SelectTrigger>
              <SelectContent>
                {agentTargets.data.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oidc-map-role">
              {t("scim.groups.eligibleRole")}
            </Label>
            <Select
              items={agentRoles.map((role) => ({
                value: role.id,
                label: `${role.name} · ${t("scim.groups.rank", { rank: role.rank })}`,
              }))}
              disabled={step.busy || !draft.scopeId || roles.isPending}
              onValueChange={(value) => setDraft({ roleId: value ?? "" })}
              value={draft.roleId}
            >
              <SelectTrigger id="oidc-map-role">
                <SelectValue
                  placeholder={
                    draft.scopeId && (roles.isPending || rolesPlaceholder)
                      ? rolesPlaceholder
                        ? t("scim.groups.rolesLoading")
                        : ""
                      : t("scim.groups.chooseRole")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {agentRoles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name} · {t("scim.groups.rank", { rank: role.rank })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {roles.isError ? (
              <p className="text-xs text-destructive-foreground" role="alert">
                {t("scim.groups.rolesFailed")}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      {customer ? (
        customer.target && customer.role ? (
          <p className="text-sm">
            {t("scim.groups.customerTarget", {
              target: customer.target.name,
              role: customer.role.name,
            })}
          </p>
        ) : (
          <Alert variant="warning">
            <AlertDescription>
              {t("scim.groups.customerUnavailable")}
            </AlertDescription>
          </Alert>
        )
      ) : null}
      {invalid === "target" ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {t("scim.groups.errors.target")}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          checked={draft.enabled}
          disabled={step.busy}
          id="oidc-map-enabled"
          onCheckedChange={(checked) => setDraft({ enabled: checked === true })}
        />
        <Label htmlFor="oidc-map-enabled">
          {t("scim.groups.mappingEnabled")}
        </Label>
      </div>
      <FailureAlert
        failure={step.failure}
        title={t("oidcGroups.notSaved")}
        onReload={() => {
          draftState.reset();
          step.clearFailure();
          step.setSecret("");
          onReload();
        }}
      />
      <StepUpFields action={step} idPrefix="oidc-step-up" />
      <p className="text-sm text-muted-foreground">
        {t("oidcGroups.evidenceNote")}
      </p>
      <div className="flex gap-2">
        <SaveButton
          disabled={
            !step.busy &&
            (loadingOptions ||
              targets.isError ||
              (!customer && Boolean(draft.scopeId) && roles.isPending) ||
              Boolean(existing && !draftState.dirty))
          }
          pending={step.busy}
          success={false}
          savedLabel={t("common:actions.saved")}
          workingLabel={t("common:actions.saving")}
          announceSuccess={false}
          type="submit"
        >
          {existing ? t("scim.groups.save") : t("scim.groups.create")}
        </SaveButton>
        <Button
          disabled={step.busy}
          onClick={() => onOpenMapping(undefined)}
          type="button"
          variant="outline"
        >
          {t("scim.groups.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function OidcGroupMappingsSettings({
  connectionId,
  openMapping,
  onOpenMapping,
}: {
  connectionId: string;
  openMapping: string | undefined;
  onOpenMapping: (mapping: string | undefined) => void;
}) {
  const { t } = useTranslation("identityConnections");
  const query = useOidcGroupMappings(connectionId);
  const step = useStepUpAction();
  const mutations = useIdentityConnectionMutations(connectionId);
  const placeholderVisible = useDelayedPending(query.isPending);
  const transition = (mapping: string | undefined) => {
    step.clearFailure();
    step.setSecret("");
    onOpenMapping(mapping);
  };
  if (!query.isError && (query.isPending || (placeholderVisible && query.data)))
    return (
      <div
        role="status"
        aria-label={t("oidcGroups.loading")}
        className="space-y-3"
        style={{ visibility: placeholderVisible ? "visible" : "hidden" }}
      >
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (query.isError || !query.data) {
    const kind = identityAdminFailureKind(query.error);
    return (
      <Alert variant="error">
        <AlertTitle>{t("oidcGroups.loadFailed")}</AlertTitle>
        <AlertDescription>
          <p>
            {kind === "denied"
              ? t("errors.denied")
              : kind === "not_found"
                ? t("errors.not_found")
                : kind === "unavailable"
                  ? t("errors.unavailable")
                  : t("oidcGroups.loadFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  async function run(
    request: OidcGroupMappingCreateInput | OidcGroupMappingUpdateInput,
    mappingId?: string,
  ) {
    const result =
      "externalGroupId" in request
        ? await step.run(
            { operation: "oidc_group_mapping_create", connectionId, request },
            (stepUpToken) =>
              mutations.createOidcMapping.mutateAsync({
                connectionId,
                body: request,
                stepUpToken,
              }),
          )
        : await step.run(
            {
              operation: "oidc_group_mapping_update",
              connectionId,
              mappingId: mappingId ?? "",
              request,
            },
            (stepUpToken) =>
              mutations.updateOidcMapping.mutateAsync({
                connectionId,
                mappingId: mappingId ?? "",
                body: request,
                stepUpToken,
              }),
          );
    return result.ok;
  }
  return (
    <div className="space-y-4">
      <OidcMappingsLoaded
        connectionId={connectionId}
        settings={query.data}
        openMapping={openMapping}
        onOpenMapping={transition}
        onReload={() => void query.refetch()}
        step={step}
        run={run}
      />
    </div>
  );
}
