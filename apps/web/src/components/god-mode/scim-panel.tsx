import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Separator,
  Skeleton,
} from "@taskdesk/ui";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/fetchers/get-api-url";
import { identityAdminFailureKind } from "@/fetchers/god-mode/identity-admin-error";
import type { ScimAdminRequest } from "@/fetchers/god-mode/identity-connections";
import { useIdentityConnectionMutations } from "@/hooks/mutations/god-mode/use-identity-connection-mutations";
import { useScimAdminSettings } from "@/hooks/queries/god-mode/use-identity-connections";
import { useServerDraft } from "@/hooks/use-server-draft";
import { useStepUpAction } from "@/hooks/use-step-up-action";
import {
  draftFromScim,
  type ScimSettingsDraft,
} from "@/lib/identity-connection-form";
import { ScimGroupMappingsSettings } from "./scim-group-mappings-settings";
import {
  ScimProfileMappingSection,
  ScimSettingsSection,
} from "./scim-settings-sections";
import { ScimTokenSettings } from "./scim-token-settings";
import { FailureAlert, StepUpFields } from "./step-up-fields";

/** The SCIM provisioning base URL: one endpoint family on the agent origin (IP-11). */
export function scimEndpointUrl(): string {
  const api = getApiUrl("");
  const origin = /^https?:\/\//u.test(api)
    ? new URL(api).origin
    : window.location.origin;
  return `${origin}/scim/v2`;
}

type Notice =
  | "settings"
  | "profile"
  | "enabled"
  | "disabled"
  | "mappingCreated"
  | "mappingUpdated"
  | "rotated"
  | "revoked";

export function ScimPanel({
  connectionId,
  openMapping,
  onOpenMapping,
}: {
  connectionId: string;
  openMapping: string | undefined;
  onOpenMapping: (mapping: string | undefined) => void;
}) {
  const { t } = useTranslation("identityConnections");
  const query = useScimAdminSettings(connectionId, true);
  if (query.isPending) {
    return (
      <div aria-label={t("scim.loading")} className="space-y-3" role="status">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    const kind = identityAdminFailureKind(query.error);
    return (
      <Alert variant="error">
        <AlertTitle>{t("scim.unavailable")}</AlertTitle>
        <AlertDescription>
          <p>
            {kind === "denied"
              ? t("errors.denied")
              : kind === "not_found"
                ? t("errors.not_found")
                : kind === "unavailable"
                  ? t("scim.storedInvalid")
                  : t("scim.loadFailed")}
          </p>
          <Button
            onClick={() => void query.refetch()}
            type="button"
            variant="outline"
          >
            {t("common.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <ScimPanelLoaded
      connectionId={connectionId}
      onOpenMapping={onOpenMapping}
      onReload={() => void query.refetch()}
      openMapping={openMapping}
      settings={query.data}
    />
  );
}

function ScimPanelLoaded({
  connectionId,
  settings: serverSettings,
  openMapping,
  onOpenMapping,
  onReload,
}: {
  connectionId: string;
  settings: NonNullable<ReturnType<typeof useScimAdminSettings>["data"]>;
  openMapping: string | undefined;
  onOpenMapping: (mapping: string | undefined) => void;
  onReload: () => void;
}) {
  const { t } = useTranslation("identityConnections");
  const step = useStepUpAction();
  const mutations = useIdentityConnectionMutations(connectionId);
  const draftState = useServerDraft(serverSettings, draftFromScim);
  // The snapshot the drafts were based on: its version is what a save is checked against.
  const settings = draftState.base;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastWrite, setLastWrite] = useState<"enable" | null>(null);
  const [bearer, setBearer] = useState<string | null>(null);
  const onBearer = useCallback((value: string | null) => setBearer(value), []);

  async function run(request: ScimAdminRequest, next: string) {
    setNotice(null);
    setBearer(null);
    setLastWrite(next === "enabled" ? "enable" : null);
    const result = await step.run(
      { operation: "scim_admin_update", connectionId, request },
      (token) =>
        mutations.updateScim.mutateAsync({
          id: connectionId,
          body: request,
          token,
        }),
    );
    if (result.ok) {
      draftState.reset();
      setNotice(next as Notice);
    }
    return result.ok;
  }

  const reload = () => {
    draftState.reset();
    step.clearFailure();
    onReload();
  };
  const sectionProps = {
    settings,
    draft: draftState.draft as ScimSettingsDraft,
    setDraft: draftState.setDraft,
    step,
    run,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t("scim.title")}</h2>
          <Badge variant={settings.data.enabled ? "success" : "outline"}>
            {settings.data.enabled
              ? t("scim.settings.stateEnabled")
              : t("scim.settings.stateDisabled")}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {t("editor.facts.versionValue", {
              version: settings.configVersion,
            })}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t("scim.description")}</p>
        <dl className="text-sm">
          <dt className="text-muted-foreground">{t("scim.endpoint")}</dt>
          <dd className="break-all">{scimEndpointUrl()}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          {t("scim.endpointNote")}
        </p>
        <p className="text-xs text-muted-foreground">{t("scim.statusNote")}</p>
      </header>

      <StepUpFields action={step} idPrefix="scim-step-up" />
      <p className="text-sm text-muted-foreground">{t("scim.verifyEach")}</p>

      <FailureAlert
        failure={step.failure}
        onReload={reload}
        title={t("scim.notSaved")}
      />
      {step.failure?.kind === "invalid" && lastWrite === "enable" ? (
        <Alert variant="info">
          <AlertDescription>{t("scim.enableInvalidHint")}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success">
          <AlertTitle>{t("scim.savedTitle")}</AlertTitle>
          <AlertDescription>{t(`scim.notice.${notice}`)}</AlertDescription>
        </Alert>
      ) : null}

      <ScimTokenSettings
        connectionId={connectionId}
        issuedBearer={bearer}
        mutations={mutations}
        onDone={(done) => {
          setNotice(done);
          draftState.reset();
        }}
        onIssued={onBearer}
        step={step}
        version={settings.configVersion}
      />
      <Separator />
      <ScimSettingsSection {...sectionProps} />
      <Separator />
      <ScimProfileMappingSection {...sectionProps} />
      <Separator />
      <ScimGroupMappingsSettings
        connectionId={connectionId}
        onOpenMapping={onOpenMapping}
        openMapping={openMapping}
        run={run}
        settings={settings}
        step={step}
      />
    </div>
  );
}
