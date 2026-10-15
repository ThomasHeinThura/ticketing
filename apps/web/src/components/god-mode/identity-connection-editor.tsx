import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Textarea,
} from "@taskdesk/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { IdentityConnection } from "@/fetchers/god-mode/identity-connections";
import { useIdentityConnectionMutations } from "@/hooks/mutations/god-mode/use-identity-connection-mutations";
import { useServerDraft } from "@/hooks/use-server-draft";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import {
  buildConfigureBody,
  buildCreateBody,
  type ConnectionDraft,
  type ConnectionFieldError,
  draftFromConnection,
  emptyConnectionDraft,
} from "@/lib/identity-connection-form";
import { FailureAlert, StepUpFields } from "./step-up-fields";

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? (
        <p className="text-xs text-muted-foreground" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const HEALTH_VARIANT = {
  unknown: "outline",
  healthy: "success",
  degraded: "warning",
  invalid: "error",
} as const;

export function IdentityConnectionEditor({
  connection,
  onCreated,
  onReload,
}: {
  /** The stored connection, or null to create a new (disabled) staff-portal connection. */
  connection: IdentityConnection | null;
  onCreated?: (id: string) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation("identityConnections");
  const creating = connection === null;
  const server = useServerDraft<IdentityConnection | null, ConnectionDraft>(
    connection,
    (value) => (value ? draftFromConnection(value) : emptyConnectionDraft()),
  );
  const { draft, setDraft } = server;
  const base = server.base;
  const step = useStepUpAction();
  const mutations = useIdentityConnectionMutations(base?.id ?? "new");
  const [errors, setErrors] = useState<ConnectionFieldError[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  const [unchanged, setUnchanged] = useState(false);

  const fieldError = (name: ConnectionFieldError) =>
    errors.includes(name) ? t(`editor.errors.${name}`) : undefined;

  function patch(next: Partial<ConnectionDraft>) {
    setDraft(next);
    setSaved(null);
    setUnchanged(false);
    step.clearFailure();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    setUnchanged(false);
    if (base === null) {
      const built = buildCreateBody(draft);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors([]);
      const result = await step.run(
        { operation: "identity_connection_create", request: built.body },
        (token) => mutations.create.mutateAsync({ body: built.body, token }),
      );
      if (result.ok) onCreated?.(result.value.id);
      return;
    }
    const built = buildConfigureBody(base, draft);
    if (built.ok === "unchanged") {
      setErrors([]);
      setUnchanged(true);
      return;
    }
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors([]);
    const result = await step.run(
      {
        operation: "identity_connection_configure",
        connectionId: base.id,
        request: built.body,
      },
      (token) =>
        mutations.configure.mutateAsync({
          id: base.id,
          body: built.body,
          token,
        }),
    );
    if (result.ok) {
      server.reset();
      setSaved(result.value.configVersion);
    }
  }

  return (
    <section aria-labelledby="identity-editor-heading" className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold" id="identity-editor-heading">
          {creating ? t("editor.addTitle") : t("editor.editTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {creating ? t("editor.introCreate") : t("editor.intro")}
        </p>
      </header>

      {base ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {t("editor.facts.issuer")}
            </dt>
            <dd className="break-all">{base.issuer}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("editor.facts.redirectUri")}
            </dt>
            <dd className="break-all">{base.redirectUri}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("editor.facts.health")}
            </dt>
            <dd>
              <Badge variant={HEALTH_VARIANT[base.healthState]}>
                {t(`editor.health.${base.healthState}`)}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("editor.facts.version")}
            </dt>
            <dd>{base.configVersion}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("editor.facts.secret")}
            </dt>
            <dd>
              {base.clientSecretConfigured
                ? t("editor.facts.secretConfigured")
                : t("editor.facts.secretMissing")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("editor.facts.mfa")}</dt>
            <dd>{t(`editor.mfa.${base.mfaUpstreamMode}`)}</dd>
          </div>
        </dl>
      ) : null}

      {base?.claimMappingState === "invalid" ? (
        <Alert variant="warning">
          <AlertTitle>{t("editor.claimInvalidTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("editor.claimInvalid")}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                aria-label={t("editor.repairClaim")}
                checked={draft.repairClaimMapping}
                disabled={step.busy}
                id="identity-repair-claim"
                onCheckedChange={(checked) =>
                  patch({ repairClaimMapping: checked === true })
                }
              />
              <Label htmlFor="identity-repair-claim">
                {t("editor.repairClaim")}
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {base?.healthState === "invalid" ? (
        <Alert variant="warning">
          <AlertTitle>{t("editor.healthInvalidTitle")}</AlertTitle>
          <AlertDescription>{t("editor.healthInvalid")}</AlertDescription>
        </Alert>
      ) : null}

      <FailureAlert
        failure={step.failure}
        onReload={() => {
          server.reset();
          setErrors([]);
          step.clearFailure();
          onReload();
        }}
        title={t("editor.notSaved")}
      />
      {unchanged ? (
        <Alert variant="info">
          <AlertDescription>{t("editor.unchanged")}</AlertDescription>
        </Alert>
      ) : null}
      {saved !== null ? (
        <Alert variant="success">
          <AlertTitle>{t("editor.saved")}</AlertTitle>
          <AlertDescription>
            {t("editor.savedDescription", { version: saved })}
          </AlertDescription>
        </Alert>
      ) : null}

      <form className="grid items-start gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field
          error={fieldError("displayName")}
          id="identity-name"
          label={t("editor.connectionName")}
        >
          <Input
            disabled={step.busy}
            id="identity-name"
            maxLength={128}
            onChange={(event) =>
              patch({ displayName: event.currentTarget.value })
            }
            value={draft.displayName}
          />
        </Field>
        <Field
          error={fieldError("tenantId")}
          help={creating ? undefined : t("editor.immutable")}
          id="identity-tenant"
          label={t("editor.tenantId")}
        >
          <Input
            disabled={step.busy || !creating}
            id="identity-tenant"
            onChange={(event) => patch({ tenantId: event.currentTarget.value })}
            value={draft.tenantId}
          />
        </Field>
        <Field
          error={fieldError("clientId")}
          id="identity-client"
          label={t("editor.clientId")}
        >
          <Input
            disabled={step.busy}
            id="identity-client"
            onChange={(event) => patch({ clientId: event.currentTarget.value })}
            value={draft.clientId}
          />
        </Field>
        <Field
          error={fieldError("clientSecret")}
          help={t("editor.secretHelp")}
          id="identity-secret"
          label={
            creating ? t("editor.clientSecret") : t("editor.replaceSecret")
          }
        >
          <Input
            autoComplete="new-password"
            disabled={step.busy}
            id="identity-secret"
            onChange={(event) =>
              patch({ clientSecret: event.currentTarget.value })
            }
            type="password"
            value={draft.clientSecret}
          />
        </Field>
        <div className="md:col-span-2">
          <Field id="identity-scopes" label={t("editor.scopes")}>
            <Input
              disabled={step.busy}
              id="identity-scopes"
              onChange={(event) => patch({ scopes: event.currentTarget.value })}
              value={draft.scopes}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field
            error={fieldError("domains")}
            help={t("editor.domainsHelp")}
            id="identity-domains"
            label={t("editor.domains")}
          >
            <Textarea
              disabled={step.busy}
              id="identity-domains"
              onChange={(event) =>
                patch({ domains: event.currentTarget.value })
              }
              rows={3}
              value={draft.domains}
            />
          </Field>
        </div>

        <fieldset className="grid gap-3 rounded-md border p-4 md:col-span-2">
          <legend className="px-1 text-sm font-medium">
            {t("editor.jitAccess")}
          </legend>
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.jitEnabled}
              disabled={step.busy}
              id="identity-jit"
              onCheckedChange={(checked) =>
                patch({ jitEnabled: checked === true })
              }
            />
            <Label htmlFor="identity-jit">{t("editor.enableJit")}</Label>
          </div>
          <Field
            error={fieldError("requiredAppRole")}
            help={t("editor.requiredAppRoleHelp")}
            id="identity-app-role"
            label={t("editor.requiredAppRole")}
          >
            <Input
              disabled={step.busy}
              id="identity-app-role"
              onChange={(event) =>
                patch({ requiredAppRole: event.currentTarget.value })
              }
              value={draft.requiredAppRole}
            />
          </Field>
          <Field
            error={fieldError("defaultWorkspaceId")}
            help={t("editor.idHelp")}
            id="identity-workspace"
            label={t("editor.workspaceId")}
          >
            <Input
              disabled={step.busy}
              id="identity-workspace"
              onChange={(event) =>
                patch({ defaultWorkspaceId: event.currentTarget.value })
              }
              value={draft.defaultWorkspaceId}
            />
          </Field>
          <Field
            error={fieldError("defaultRoleId")}
            help={t("editor.idHelp")}
            id="identity-role"
            label={t("editor.defaultRole")}
          >
            <Input
              disabled={step.busy}
              id="identity-role"
              onChange={(event) =>
                patch({ defaultRoleId: event.currentTarget.value })
              }
              value={draft.defaultRoleId}
            />
          </Field>
          <Field
            error={fieldError("maxRoleRank")}
            help={t("editor.maxRoleRankHelp")}
            id="identity-rank"
            label={t("editor.maxRoleRank")}
          >
            <Input
              disabled={step.busy}
              id="identity-rank"
              inputMode="numeric"
              onChange={(event) =>
                patch({ maxRoleRank: event.currentTarget.value })
              }
              value={draft.maxRoleRank}
            />
          </Field>
        </fieldset>

        {creating ? (
          <p className="text-sm text-muted-foreground md:col-span-2">
            {t("editor.createsDisabled")}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm md:col-span-2">
            <Checkbox
              checked={draft.enabled}
              disabled={step.busy}
              id="identity-enabled"
              onCheckedChange={(checked) =>
                patch({ enabled: checked === true })
              }
            />
            <Label htmlFor="identity-enabled">
              {t("editor.enableConnection")}
            </Label>
          </div>
        )}

        <div className="md:col-span-2">
          <StepUpFields action={step} idPrefix="identity-editor" />
        </div>
        <div className="flex gap-2 md:col-span-2">
          <Button disabled={step.busy} type="submit">
            {step.busy
              ? t("common.saving")
              : creating
                ? t("editor.createDisabled")
                : t("editor.save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
