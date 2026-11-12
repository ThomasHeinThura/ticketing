import { createId } from "@paralleldrive/cuid2";
import {
  bootstrapSmtpConfiguration,
  executeSmtp,
} from "@taskdesk/email/smtp-runtime";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import type { StepUpSpender } from "../auth/step-up-spend";
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
  writeEmailTestStatus,
} from "./repository";
import { runtimeSmtpConfiguration } from "./runtime";
import {
  emailProviderKind,
  emailTestStatus,
  isLocalMailpitCaptureEnabled,
  isValidMailpitCaptureConfig,
  parseStoredEmailConfig,
  type SmtpConfig,
  type StoredTestStatus,
  sameSmtpConfig,
  smtpConfigurationSchema,
  storedEmailConfig,
  type TestResult,
} from "./schema";
import { sesSmtpRegionOptions } from "./ses";
import {
  classifySmtpTestFailure,
  recipientDomain,
  type SmtpTestFailure,
  TEST_EMAIL_SUBJECT,
  TEST_EMAIL_TEXT,
} from "./test-result";

type Actor = { userId: string; personId: string; traceId?: string };
type Input = { version: number; config?: SmtpConfig; password?: string | null };
type TestInput = Input & { recipient: string };
/** Resets the saved test status: it described settings that no longer apply. */
const STALE_TEST_STATUS: StoredTestStatus = {
  state: "stale",
  testedAt: null,
  smtpCode: null,
  category: null,
};
const TEST_SEND_DEADLINE_MS = 15_000;
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
  const stored = row ? parseStoredEmailConfig(row.config) : null;
  const config =
    stored && isValidMailpitCaptureConfig(stored.config) ? stored.config : null;
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
    testStatus: emailTestStatus(config ? (stored?.lastTest ?? null) : null),
    sesRegions: sesSmtpRegionOptions(),
  };
}
/**
 * `spend` consumes the caller's one-use step-up proof. It runs after the version check and every
 * domain refusal and immediately before the write, so a refused or conflicting request never
 * burns a proof and a saved one always spent exactly one.
 */
export async function updateEmailProvider(
  input: Input & { enabled: boolean },
  actor: Actor,
  spend: StepUpSpender,
) {
  let auditFailed = false;
  await db.transaction(async (tx) => {
    const existing = await lockEmailProvider(tx);
    if ((existing?.configVersion ?? 0) !== input.version)
      throw new HTTPException(409, { message: "version_conflict" });
    const id = existing?.id ?? createId();
    const stored = existing ? parseStoredEmailConfig(existing.config) : null;
    const config = input.config ?? stored?.config;
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
    // A saved test result describes the settings it ran against. Changing the settings or the
    // password (it cannot be compared, so any new value counts) invalidates it; switching
    // delivery on or off does not.
    const settingsChanged =
      !stored ||
      input.password !== undefined ||
      (input.config !== undefined &&
        !sameSmtpConfig(input.config, stored.config));
    const lastTest = settingsChanged
      ? STALE_TEST_STATUS
      : (stored?.lastTest ?? null);
    await spend(tx);
    const row = await saveEmailProvider(
      tx,
      {
        id,
        pluginId: EMAIL_PLUGIN_ID,
        instanceKey: "default",
        displayName: "Email",
        enabled: input.enabled,
        config: config ? storedEmailConfig(config, lastTest) : {},
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
          provider: config ? emailProviderKind(config) : null,
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
/**
 * Sends one real, fixed test message to `input.recipient` through the same transport and egress
 * checks as every other delivery, using the unsaved form values when they are supplied. The
 * attempt is audited (recipient domain only) and rate limited before any network I/O. A failure is
 * an expected answer, not an error: it returns the category, the SMTP reply code and the sanitised
 * provider text. The result becomes the saved settings' status only when it was produced by
 * exactly those settings; a test of different unsaved values is shown but never stored.
 */
export async function testEmailProvider(
  input: TestInput,
  actor: Actor,
): Promise<TestResult> {
  const selected = await db.transaction(async (tx) => {
    const row = await lockEmailProvider(tx);
    if ((row?.configVersion ?? 0) !== input.version)
      throw new HTTPException(409, { message: "version_conflict" });
    const stored = row ? parseStoredEmailConfig(row.config) : null;
    const config = input.config ?? (row ? stored?.config : bootstrapConfig());
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
          provider: emailProviderKind(config),
          host: config.host,
          // The domain only: neither the address nor any secret is ever recorded.
          recipientDomain: recipientDomain(input.recipient),
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
      config,
      // The result describes the saved settings only when nothing was overridden.
      target:
        row &&
        stored &&
        input.password === undefined &&
        (input.config === undefined ||
          sameSmtpConfig(input.config, stored.config))
          ? { id: row.id, version: row.configVersion, config: stored.config }
          : null,
    };
  });
  if (selected.kind === "audit_unavailable") {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    throw new HTTPException(503, {
      message: "SMTP verification audit unavailable",
    });
  }
  let outcome: { ok: true } | (SmtpTestFailure & { ok: false });
  try {
    await executeSmtp(
      selected.smtp,
      {
        to: input.recipient,
        subject: TEST_EMAIL_SUBJECT,
        text: TEST_EMAIL_TEXT,
      },
      { deadlineMs: TEST_SEND_DEADLINE_MS, includeReply: true },
    );
    outcome = { ok: true };
  } catch (error) {
    outcome = { ok: false, ...classifySmtpTestFailure(error) };
  }
  const testedAt = new Date().toISOString();
  const status: StoredTestStatus = outcome.ok
    ? { state: "verified", testedAt, smtpCode: null, category: null }
    : {
        state: "failed",
        testedAt,
        smtpCode: outcome.smtpCode,
        category: outcome.category,
      };
  const persisted = selected.target
    ? await recordTestStatus(selected.target, status)
    : false;
  return outcome.ok
    ? {
        ok: true,
        testedAt,
        recipientDomain: recipientDomain(input.recipient),
        persisted,
      }
    : {
        ok: false,
        testedAt,
        category: outcome.category,
        smtpCode: outcome.smtpCode,
        providerText: outcome.providerText,
        persisted,
      };
}

/** The status is a convenience: failing to store it never changes what the test reported. */
async function recordTestStatus(
  target: { id: string; version: number; config: SmtpConfig },
  status: StoredTestStatus,
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const current = await lockEmailProvider(tx);
      const stored = current ? parseStoredEmailConfig(current.config) : null;
      // Settings saved since the test ran: the result no longer describes them.
      if (
        !current ||
        !stored ||
        current.id !== target.id ||
        current.configVersion !== target.version ||
        !sameSmtpConfig(stored.config, target.config)
      )
        return false;
      return writeEmailTestStatus(tx, {
        id: target.id,
        expectedVersion: target.version,
        config: storedEmailConfig(stored.config, status),
      });
    });
  } catch {
    return false;
  }
}
