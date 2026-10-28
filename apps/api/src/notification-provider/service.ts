import { createId } from "@paralleldrive/cuid2";
import {
  bootstrapSmtpConfiguration,
  executeSmtp,
  SmtpAttemptError,
} from "@taskdesk/email/smtp-runtime";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../identity/client-secret";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  EMAIL_PLUGIN_ID,
  lockEmailProvider,
  readEmailProvider,
  saveEmailProvider,
} from "./repository";
import { runtimeSmtpConfiguration } from "./runtime";
import {
  isLocalMailpitCaptureEnabled,
  isValidMailpitCaptureConfig,
  type SmtpConfig,
  smtpConfigurationSchema,
} from "./schema";

type Actor = { userId: string; personId: string; traceId?: string };
type Input = { version: number; config?: SmtpConfig; password?: string | null };
function bootstrapConfig(): SmtpConfig | null {
  const bootstrap = bootstrapSmtpConfiguration();
  if (!bootstrap?.options.host) return null;
  const auth = bootstrap.options.auth;
  const parsed = smtpConfigurationSchema.safeParse({
    host: bootstrap.options.host,
    port: Number(
      bootstrap.options.port ?? (bootstrap.options.secure ? 465 : 587),
    ),
    secure: bootstrap.options.secure === true,
    requireTLS: bootstrap.options.requireTLS === true,
    username: auth && "user" in auth ? (auth.user ?? null) : null,
    fromAddress: bootstrap.from,
    replyTo: null,
  });
  return parsed.success ? parsed.data : null;
}
export async function getEmailProvider() {
  const row = await readEmailProvider();
  const parsedConfig = row
    ? smtpConfigurationSchema.safeParse(row.config)
    : null;
  const config =
    parsedConfig?.success && isValidMailpitCaptureConfig(parsedConfig.data)
      ? parsedConfig.data
      : null;
  const bootstrap = row ? null : bootstrapSmtpConfiguration();
  const passwordConfigured = row
    ? row.secrets !== null
    : Boolean(
        bootstrap?.options.auth &&
          "pass" in bootstrap.options.auth &&
          bootstrap.options.auth.pass,
      );
  return {
    version: row?.configVersion ?? 0,
    source: row
      ? ("runtime" as const)
      : bootstrap
        ? ("bootstrap" as const)
        : ("unconfigured" as const),
    enabled: row ? row.enabled : bootstrap !== null,
    config: row ? config : bootstrapConfig(),
    passwordConfigured,
    passwordPreview: passwordConfigured ? ("••••••••" as const) : null,
    localMailpitCaptureAvailable: isLocalMailpitCaptureEnabled(),
  };
}
export async function updateEmailProvider(
  input: Input & { enabled: boolean },
  actor: Actor,
) {
  let auditFailed = false;
  await db.transaction(async (tx) => {
    const existing = await lockEmailProvider(tx);
    if ((existing?.configVersion ?? 0) !== input.version)
      throw new HTTPException(409, { message: "version_conflict" });
    const id = existing?.id ?? createId();
    const config =
      input.config ??
      (existing
        ? smtpConfigurationSchema.safeParse(existing.config).data
        : undefined);
    if (input.enabled && !config)
      throw new HTTPException(400, { message: "SMTP configuration required" });
    if (config?.captureToMailpit === true) {
      const disablingUnchangedCapture =
        !input.enabled && input.config === undefined;
      if (!isLocalMailpitCaptureEnabled() && !disablingUnchangedCapture)
        throw new HTTPException(400, {
          message: "Local mail capture unavailable",
        });
      if (!isValidMailpitCaptureConfig(config))
        throw new HTTPException(400, {
          message: "Invalid local mail capture configuration",
        });
    }
    // Bootstrap secrets are never silently copied into a newly created runtime row.
    const secrets =
      input.password === undefined
        ? (existing?.secrets ?? null)
        : input.password === null
          ? null
          : encryptIdentityClientSecret(id, input.password);
    if (config?.captureToMailpit === true && secrets !== null)
      throw new HTTPException(400, {
        message: "Clear SMTP credentials before enabling local mail capture",
      });
    if (input.enabled && config?.username && !secrets)
      throw new HTTPException(400, { message: "SMTP password required" });
    const row = await saveEmailProvider(
      tx,
      {
        id,
        pluginId: EMAIL_PLUGIN_ID,
        instanceKey: "default",
        displayName: "Email",
        enabled: input.enabled,
        config: config ?? {},
        secrets,
        scope: "instance",
        workspaceId: null,
        portalScope: null,
        configVersion: input.version + 1,
        updatedBy: actor.personId,
        updatedAt: new Date(),
      },
      input.version,
    );
    if (!row) throw new HTTPException(409, { message: "version_conflict" });
    try {
      await appendAuditLog(tx, {
        action: "plugin.changed",
        actorId: actor.userId,
        actorType: "person",
        entityType: "instance_plugin_config",
        entityId: id,
        workspaceId: null,
        traceId: actor.traceId,
        after: {
          pluginId: EMAIL_PLUGIN_ID,
          host: config?.host ?? null,
          changedKeys: [
            "enabled",
            ...(input.config ? ["config"] : []),
            ...(input.password !== undefined ? ["password"] : []),
          ],
        },
      });
    } catch {
      auditFailed = true;
    }
  });
  if (auditFailed) {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  return getEmailProvider();
}
export async function testEmailProvider(input: Input, actor: Actor) {
  const selected = await db.transaction(async (tx) => {
    const row = await lockEmailProvider(tx);
    if ((row?.configVersion ?? 0) !== input.version)
      throw new HTTPException(409, { message: "version_conflict" });
    const config =
      input.config ??
      (row
        ? smtpConfigurationSchema.safeParse(row.config).data
        : bootstrapConfig());
    if (!config)
      throw new HTTPException(400, { message: "SMTP configuration required" });
    if (config.captureToMailpit === true) {
      if (!isLocalMailpitCaptureEnabled())
        throw new HTTPException(400, {
          message: "Local mail capture unavailable",
        });
      if (!isValidMailpitCaptureConfig(config))
        throw new HTTPException(400, {
          message: "Invalid local mail capture configuration",
        });
    }
    const password =
      input.password === undefined
        ? row?.secrets
          ? decryptIdentityClientSecret(row.id, row.secrets)
          : null
        : input.password;
    if (config.captureToMailpit === true && password !== null)
      throw new HTTPException(400, {
        message: "Clear SMTP credentials before testing local mail capture",
      });
    if (config.username && !password)
      throw new HTTPException(400, { message: "SMTP password required" });
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(782023, hashtext(${actor.userId}))`,
    );
    const recent = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM audit_log WHERE action='plugin.tested' AND actor_id=${actor.userId} AND created_at > clock_timestamp() - interval '1 minute'`,
    );
    if ((recent.rows[0]?.count ?? 0) >= 5)
      throw new HTTPException(429, { message: "rate_limited" });
    try {
      await appendAuditLog(tx, {
        action: "plugin.tested",
        actorId: actor.userId,
        actorType: "person",
        entityType: "instance_plugin_config",
        entityId: row?.id ?? EMAIL_PLUGIN_ID,
        workspaceId: null,
        traceId: actor.traceId,
        after: {
          pluginId: EMAIL_PLUGIN_ID,
          host: config.host,
          changedKeys: [
            ...(input.config ? ["config"] : []),
            ...(input.password !== undefined ? ["password"] : []),
          ],
        },
      });
    } catch {
      return { kind: "audit_unavailable" as const };
    }
    return {
      kind: "ready" as const,
      smtp: runtimeSmtpConfiguration(config, password),
    };
  });
  if (selected.kind === "audit_unavailable") {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    throw new HTTPException(503, {
      message: "SMTP verification audit unavailable",
    });
  }
  try {
    await executeSmtp(selected.smtp, null, { deadlineMs: 10_000 });
    return { verified: true as const };
  } catch (error) {
    const message =
      error instanceof SmtpAttemptError
        ? error.kind === "deadline"
          ? "smtp_timeout"
          : error.diagnostic === "authentication"
            ? "smtp_authentication_failed"
            : error.diagnostic === "connection"
              ? "smtp_connection_failed"
              : error.diagnostic === "tls"
                ? "smtp_tls_failed"
                : "smtp_verification_failed"
        : "smtp_verification_failed";
    throw new HTTPException(502, { message });
  }
}
