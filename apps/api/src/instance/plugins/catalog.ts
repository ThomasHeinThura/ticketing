import { sql } from "drizzle-orm";
import db from "../../database";
import { smtpSettingsFormManifest } from "../../notification-provider/schema";
import { getEmailProvider } from "../../notification-provider/service";
import { getStorageBackendStatus } from "../../storage";
import { readS3Draft } from "../../storage/s3-draft-repository";

export type SupportedPluginId =
  | "notify.email"
  | "storage.s3"
  | "identity.sso"
  | "observability.telemetry";

export type SupportedPluginKind =
  | "notification"
  | "storage"
  | "identity"
  | "observability";

export type SubprocessorCategory =
  | "outbound_email"
  | "object_storage"
  | "identity_provider"
  | "telemetry";

export type SupportedPluginConfigPath =
  | "/god-mode/notifications"
  | "/god-mode/storage"
  | "/god-mode/authentication"
  | "/god-mode/observability";

export type SupportedPlugin = {
  id: SupportedPluginId;
  name: string;
  kind: SupportedPluginKind;
  category: SubprocessorCategory;
  state: "unconfigured" | "enabled" | "disabled" | "invalid";
  source: "runtime" | "bootstrap" | "unconfigured";
  configVersion: number;
  credentialConfigured: boolean;
  dataProcessed: string;
  destinationSummary: string;
  configPath: SupportedPluginConfigPath;
  settingsForm:
    | ReturnType<typeof smtpSettingsFormManifest>
    | { version: 1; available: false };
};

type EmailProviderSummary = Awaited<ReturnType<typeof getEmailProvider>>;

export type StorageSubprocessorRuntime = {
  driver: "filesystem" | "s3" | "unsupported";
  configuration: "configured" | "incomplete" | "unavailable" | "unsupported";
  hasDraft: boolean;
  draftVersion: number;
  draftCredentialConfigured: boolean;
};

export type IdentitySubprocessorRuntime = {
  totalCount: number;
  enabledCount: number;
  scimEnabledCount: number;
  maxConfigVersion: number;
};

export type TelemetrySubprocessorRuntime = {
  metricsTokenConfigured: boolean;
  observabilityConfigVersion: number;
  pluginRowCount: number;
  pluginEnabledCount: number;
  pluginMaxVersion: number;
  pluginCredentialConfigured: boolean;
};

export type SubprocessorRuntimeInputs = {
  storage?: StorageSubprocessorRuntime;
  identity?: IdentitySubprocessorRuntime;
  telemetry?: TelemetrySubprocessorRuntime;
};

const DEFAULT_STORAGE_RUNTIME: StorageSubprocessorRuntime = {
  driver: "filesystem",
  configuration: "configured",
  hasDraft: false,
  draftVersion: 0,
  draftCredentialConfigured: false,
};

const DEFAULT_IDENTITY_RUNTIME: IdentitySubprocessorRuntime = {
  totalCount: 0,
  enabledCount: 0,
  scimEnabledCount: 0,
  maxConfigVersion: 0,
};

const DEFAULT_TELEMETRY_RUNTIME: TelemetrySubprocessorRuntime = {
  metricsTokenConfigured: false,
  observabilityConfigVersion: 1,
  pluginRowCount: 0,
  pluginEnabledCount: 0,
  pluginMaxVersion: 0,
  pluginCredentialConfigured: false,
};

const UNAVAILABLE_FORM = { version: 1 as const, available: false as const };

function projectEmailSubprocessor(
  email: EmailProviderSummary,
): SupportedPlugin {
  const state =
    email.config === null
      ? email.source === "unconfigured"
        ? "unconfigured"
        : "invalid"
      : email.enabled
        ? "enabled"
        : "disabled";

  let destinationSummary = "Disabled";
  if (state === "enabled") {
    if (email.config?.captureToMailpit === true) {
      destinationSummary = "Local Mailpit capture";
    } else if (email.config?.provider === "ses") {
      destinationSummary = "Configured Amazon SES relay";
    } else {
      destinationSummary = "Configured SMTP relay";
    }
  } else if (state === "disabled") {
    destinationSummary = "Disabled (saved relay inactive)";
  } else if (state === "invalid") {
    destinationSummary = "Disabled (configuration invalid)";
  }

  return {
    id: "notify.email",
    name: "Email",
    kind: "notification",
    category: "outbound_email",
    state,
    source: email.source,
    configVersion: email.version,
    credentialConfigured: email.passwordConfigured,
    dataProcessed:
      "Recipient email addresses, notification subjects, and message bodies",
    destinationSummary,
    configPath: "/god-mode/notifications",
    settingsForm: smtpSettingsFormManifest(),
  };
}

function projectStorageSubprocessor(
  storage: StorageSubprocessorRuntime,
): SupportedPlugin {
  if (storage.driver === "s3") {
    const configured = storage.configuration === "configured";
    return {
      id: "storage.s3",
      name: "S3 Object Storage",
      kind: "storage",
      category: "object_storage",
      state: configured ? "enabled" : "invalid",
      source: "bootstrap",
      configVersion: storage.draftVersion,
      credentialConfigured: configured || storage.draftCredentialConfigured,
      dataProcessed:
        "Work item, comment, and portal submission attachment objects",
      destinationSummary: configured
        ? "Active S3-compatible object storage"
        : "Incomplete bootstrap S3 configuration",
      configPath: "/god-mode/storage",
      settingsForm: UNAVAILABLE_FORM,
    };
  }

  return {
    id: "storage.s3",
    name: "S3 Object Storage",
    kind: "storage",
    category: "object_storage",
    state: storage.hasDraft ? "disabled" : "unconfigured",
    source: storage.hasDraft ? "runtime" : "unconfigured",
    configVersion: storage.draftVersion,
    credentialConfigured: storage.draftCredentialConfigured,
    dataProcessed:
      "Work item, comment, and portal submission attachment objects",
    destinationSummary: storage.hasDraft
      ? "Disabled (inactive S3 draft saved; local filesystem active)"
      : "Disabled",
    configPath: "/god-mode/storage",
    settingsForm: UNAVAILABLE_FORM,
  };
}

function projectIdentitySubprocessor(
  identity: IdentitySubprocessorRuntime,
): SupportedPlugin {
  const state =
    identity.enabledCount > 0
      ? "enabled"
      : identity.totalCount > 0
        ? "disabled"
        : "unconfigured";

  let destinationSummary = "Disabled";
  if (identity.enabledCount > 0) {
    const oidcLabel =
      identity.enabledCount === 1
        ? "1 active OIDC connection"
        : `${identity.enabledCount} active OIDC connections`;
    destinationSummary =
      identity.scimEnabledCount > 0
        ? `${oidcLabel}, ${identity.scimEnabledCount} SCIM enabled`
        : oidcLabel;
  } else if (identity.totalCount > 0) {
    destinationSummary =
      identity.totalCount === 1
        ? "Disabled (1 configured connection inactive)"
        : `Disabled (${identity.totalCount} configured connections inactive)`;
  }

  return {
    id: "identity.sso",
    name: "Identity Providers & SCIM",
    kind: "identity",
    category: "identity_provider",
    state,
    source: identity.totalCount > 0 ? "runtime" : "unconfigured",
    configVersion: identity.maxConfigVersion,
    credentialConfigured: identity.totalCount > 0,
    dataProcessed:
      "User identifiers, email addresses, display names, and group memberships",
    destinationSummary,
    configPath: "/god-mode/authentication",
    settingsForm: UNAVAILABLE_FORM,
  };
}

function projectTelemetrySubprocessor(
  telemetry: TelemetrySubprocessorRuntime,
): SupportedPlugin {
  const exporterEnabled = telemetry.pluginEnabledCount > 0;
  const metricsEnabled = telemetry.metricsTokenConfigured;
  const enabled = exporterEnabled || metricsEnabled;
  const hasSavedState = enabled || telemetry.pluginRowCount > 0;

  let destinationSummary = "Disabled";
  if (exporterEnabled && metricsEnabled) {
    destinationSummary =
      "Configured telemetry exporter and authenticated metrics endpoint";
  } else if (exporterEnabled) {
    destinationSummary = "Configured telemetry exporter";
  } else if (metricsEnabled) {
    destinationSummary = "Authenticated metrics scrape endpoint enabled";
  } else if (telemetry.pluginRowCount > 0) {
    destinationSummary = "Disabled (saved telemetry configuration inactive)";
  }

  return {
    id: "observability.telemetry",
    name: "Error Reporting & Telemetry",
    kind: "observability",
    category: "telemetry",
    state: enabled
      ? "enabled"
      : telemetry.pluginRowCount > 0
        ? "disabled"
        : "unconfigured",
    source: hasSavedState ? "runtime" : "unconfigured",
    configVersion: hasSavedState
      ? Math.max(
          telemetry.pluginMaxVersion,
          telemetry.observabilityConfigVersion,
        )
      : 0,
    credentialConfigured:
      metricsEnabled || telemetry.pluginCredentialConfigured,
    dataProcessed:
      "Operational service metrics and allowlisted diagnostic metadata",
    destinationSummary,
    configPath: "/god-mode/observability",
    settingsForm: UNAVAILABLE_FORM,
  };
}

/**
 * Projects the live subprocessor and outbound integration register for God Mode -> Plugins
 * (`operations-and-distribution.md` § Sub-processors: none by default; optional outbound
 * integrations — email relay, S3 storage, identity providers, telemetry — are configured and
 * visible in God Mode -> Plugins without exposing hostnames, endpoints, DSNs, or credentials).
 */
export function projectSupportedPlugins(
  email: EmailProviderSummary,
  runtime: SubprocessorRuntimeInputs = {},
): SupportedPlugin[] {
  return [
    projectEmailSubprocessor(email),
    projectStorageSubprocessor(runtime.storage ?? DEFAULT_STORAGE_RUNTIME),
    projectIdentitySubprocessor(runtime.identity ?? DEFAULT_IDENTITY_RUNTIME),
    projectTelemetrySubprocessor(
      runtime.telemetry ?? DEFAULT_TELEMETRY_RUNTIME,
    ),
  ];
}

async function readIdentitySubprocessorRuntime(): Promise<IdentitySubprocessorRuntime> {
  const result = await db.execute<{
    totalCount: number | string;
    enabledCount: number | string;
    scimEnabledCount: number | string;
    maxConfigVersion: number | string;
  }>(sql`
    SELECT
      count(*)::int AS "totalCount",
      count(*) FILTER (WHERE ic."enabled" = true)::int AS "enabledCount",
      count(*) FILTER (WHERE sc."enabled" = true)::int AS "scimEnabledCount",
      COALESCE(max(ic."config_version"), 0)::int AS "maxConfigVersion"
    FROM "identity_connection" ic
    LEFT JOIN "scim_connection" sc
      ON sc."identity_connection_id" = ic."id"
    WHERE ic."deleted_at" IS NULL
  `);
  const row = result.rows[0];
  return {
    totalCount: Number(row?.totalCount ?? 0),
    enabledCount: Number(row?.enabledCount ?? 0),
    scimEnabledCount: Number(row?.scimEnabledCount ?? 0),
    maxConfigVersion: Number(row?.maxConfigVersion ?? 0),
  };
}

async function readTelemetrySubprocessorRuntime(): Promise<TelemetrySubprocessorRuntime> {
  const result = await db.execute<{
    metricsTokenConfigured: boolean;
    observabilityConfigVersion: number | string;
    pluginRowCount: number | string;
    pluginEnabledCount: number | string;
    pluginMaxVersion: number | string;
    pluginCredentialConfigured: boolean;
  }>(sql`
    SELECT
      COALESCE(
        (
          SELECT (s."metrics_token_hash" IS NOT NULL)
          FROM "instance_setting" s
          WHERE s."id" = 'singleton'
          LIMIT 1
        ),
        false
      ) AS "metricsTokenConfigured",
      COALESCE(
        (
          SELECT s."observability_config_version"
          FROM "instance_setting" s
          WHERE s."id" = 'singleton'
          LIMIT 1
        ),
        1
      )::int AS "observabilityConfigVersion",
      (
        SELECT count(*)::int
        FROM "instance_plugin_config" p
        WHERE p."plugin_id" IN ('observability.telemetry', 'observability.sentry', 'observability.otlp')
      ) AS "pluginRowCount",
      (
        SELECT count(*)::int
        FROM "instance_plugin_config" p
        WHERE p."plugin_id" IN ('observability.telemetry', 'observability.sentry', 'observability.otlp')
          AND p."enabled" = true
      ) AS "pluginEnabledCount",
      COALESCE(
        (
          SELECT max(p."config_version")::int
          FROM "instance_plugin_config" p
          WHERE p."plugin_id" IN ('observability.telemetry', 'observability.sentry', 'observability.otlp')
        ),
        0
      ) AS "pluginMaxVersion",
      EXISTS (
        SELECT 1
        FROM "instance_plugin_config" p
        WHERE p."plugin_id" IN ('observability.telemetry', 'observability.sentry', 'observability.otlp')
          AND p."secrets" IS NOT NULL
      ) AS "pluginCredentialConfigured"
  `);
  const row = result.rows[0];
  return {
    metricsTokenConfigured: Boolean(row?.metricsTokenConfigured),
    observabilityConfigVersion: Number(row?.observabilityConfigVersion ?? 1),
    pluginRowCount: Number(row?.pluginRowCount ?? 0),
    pluginEnabledCount: Number(row?.pluginEnabledCount ?? 0),
    pluginMaxVersion: Number(row?.pluginMaxVersion ?? 0),
    pluginCredentialConfigured: Boolean(row?.pluginCredentialConfigured),
  };
}

export async function listSupportedPlugins() {
  const [email, storageBackend, s3Draft, identity, telemetry] =
    await Promise.all([
      getEmailProvider(),
      getStorageBackendStatus(),
      readS3Draft(),
      readIdentitySubprocessorRuntime(),
      readTelemetrySubprocessorRuntime(),
    ]);

  return projectSupportedPlugins(email, {
    storage: {
      driver: storageBackend.driver,
      configuration: storageBackend.configuration,
      hasDraft: Boolean(s3Draft),
      draftVersion: s3Draft?.configVersion ?? 0,
      draftCredentialConfigured: Boolean(s3Draft?.secrets),
    },
    identity,
    telemetry,
  });
}
