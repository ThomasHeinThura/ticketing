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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ScimAdminRequest,
  ScimAdminSettings,
  ScimGroupMapping,
  ScimMappingOptions,
} from "@/fetchers/god-mode/identity-connections";
import { useScimMappingOptions } from "@/hooks/queries/god-mode/use-identity-connections";
import { useServerDraft } from "@/hooks/use-server-draft";
import type { StepUpAction } from "@/hooks/use-step-up-action";
import {
  buildMappingRequest,
  draftFromMapping,
  emptyMappingDraft,
  isValidDisplaySnapshot,
  isValidExternalGroupId,
  type MappingDraft,
} from "@/lib/identity-connection-form";

type Props = {
  connectionId: string;
  settings: ScimAdminSettings;
  /** `new`, a mapping id, or undefined when the form is closed (URL state). */
  openMapping: string | undefined;
  onOpenMapping: (mapping: string | undefined) => void;
  step: StepUpAction;
  run: (request: ScimAdminRequest, notice: string) => Promise<boolean>;
};

function isKind<K extends ScimMappingOptions["kind"]>(
  options: ScimMappingOptions,
  kind: K,
): options is Extract<ScimMappingOptions, { kind: K }> {
  return options.kind === kind;
}

/** Both the read and the form-open state of group mappings are explicit; nothing here deletes a mapping. */
export function ScimGroupMappingsSettings(props: Props) {
  const { t } = useTranslation("identityConnections");
  const { settings, openMapping, onOpenMapping, step } = props;
  const mappings = settings.data.mappings;
  const existing =
    openMapping && openMapping !== "new"
      ? (mappings.find((mapping) => mapping.id === openMapping) ?? null)
      : null;
  const canCreate =
    settings.data.allowedResources.includes("groups") && settings.data.enabled;

  return (
    <section aria-labelledby="scim-groups-heading" className="space-y-4">
      <header className="space-y-1">
        <h3 className="font-semibold" id="scim-groups-heading">
          {t("scim.groups.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("scim.groups.description")}
        </p>
      </header>
      {mappings.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("scim.groups.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("scim.groups.empty")}</EmptyDescription>
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
                  {mapping.roleId}
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
            disabled={step.busy || !canCreate}
            onClick={() => onOpenMapping("new")}
            type="button"
          >
            {t("scim.groups.add")}
          </Button>
          {!canCreate ? (
            <p className="text-sm text-muted-foreground">
              {t("scim.groups.addUnavailable")}
            </p>
          ) : null}
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
}: Props & { existing: ScimGroupMapping | null }) {
  const { t } = useTranslation("identityConnections");
  const draftState = useServerDraft<ScimGroupMapping | null, MappingDraft>(
    existing,
    (value) => (value ? draftFromMapping(value) : emptyMappingDraft()),
  );
  const { draft, setDraft } = draftState;
  const [invalid, setInvalid] = useState<
    "externalId" | "snapshot" | "target" | null
  >(null);

  const targets = useScimMappingOptions(connectionId, undefined, true);
  const targetData = targets.data;
  const agentTargets =
    targetData && isKind(targetData, "agent_targets") ? targetData : null;
  const customer =
    targetData && isKind(targetData, "customer") ? targetData : null;
  const roles = useScimMappingOptions(
    connectionId,
    draft.scopeId || undefined,
    Boolean(agentTargets && draft.scopeId),
  );
  const roleData = roles.data;
  const agentRoles =
    roleData && isKind(roleData, "agent_roles") ? roleData.data : [];

  const roleId = customer ? (customer.role?.id ?? "") : draft.roleId;
  const scopeId = customer ? (customer.target?.id ?? "") : draft.scopeId;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!existing && !isValidExternalGroupId(draft.externalGroupId.trim())) {
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
    const request = buildMappingRequest({
      version: settings.configVersion,
      existing,
      draft: {
        ...draft,
        externalGroupId: draft.externalGroupId.trim(),
        roleId,
        scopeId,
      },
      customer: Boolean(customer),
    });
    if (request === null) {
      onOpenMapping(undefined);
      return;
    }
    const ok = await run(
      request,
      existing ? "mappingUpdated" : "mappingCreated",
    );
    if (ok) onOpenMapping(undefined);
  }

  const loadingOptions = targets.isPending;
  return (
    <form
      aria-labelledby="scim-mapping-form-heading"
      className="space-y-4 rounded-md border p-4"
      onSubmit={submit}
    >
      <h4 className="font-medium" id="scim-mapping-form-heading">
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
      {loadingOptions ? (
        <p role="status">{t("scim.groups.optionsLoading")}</p>
      ) : null}
      {existing ? (
        <p className="break-all text-sm">
          {t("scim.groups.externalId")}: {existing.externalGroupId}
        </p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="scim-map-external">
            {t("scim.groups.externalId")}
          </Label>
          <Input
            disabled={step.busy}
            id="scim-map-external"
            onChange={(event) =>
              setDraft({ externalGroupId: event.currentTarget.value })
            }
            value={draft.externalGroupId}
          />
          <p className="text-xs text-muted-foreground">
            {t("scim.groups.externalIdHelp")}
          </p>
          {invalid === "externalId" ? (
            <p className="text-xs text-destructive-foreground" role="alert">
              {t("scim.groups.errors.externalId")}
            </p>
          ) : null}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="scim-map-name">{t("scim.groups.displayName")}</Label>
        <Input
          disabled={step.busy}
          id="scim-map-name"
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
            <Label htmlFor="scim-map-workspace">
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
              <SelectTrigger id="scim-map-workspace">
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
            <Label htmlFor="scim-map-role">
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
              <SelectTrigger id="scim-map-role">
                <SelectValue
                  placeholder={
                    draft.scopeId && roles.isPending
                      ? t("scim.groups.rolesLoading")
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
          id="scim-map-enabled"
          onCheckedChange={(checked) => setDraft({ enabled: checked === true })}
        />
        <Label htmlFor="scim-map-enabled">
          {t("scim.groups.mappingEnabled")}
        </Label>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("scim.groups.evidenceNote")}
      </p>
      <div className="flex gap-2">
        <Button
          disabled={step.busy || loadingOptions || targets.isError}
          type="submit"
        >
          {step.busy
            ? t("common.saving")
            : existing
              ? t("scim.groups.save")
              : t("scim.groups.create")}
        </Button>
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
