import { createHash } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import {
  type AuthPluginConfigRow,
  isEmailOtpSignInDisabledByEnvironment,
  type LocalAuthProviders,
  portalForHost,
  resolveLocalAuthProviders,
  resolveStoredLocalAuthProviders,
} from "../auth";
import { publishCommittedAuthConfigurationReload } from "../auth/configuration-reload";
import { AUTH_LOCAL_METHODS_UPDATE_OPERATION } from "../auth/step-up-ext";
import { runWithStepUp, stepUpTokenHeader } from "../auth/step-up-spend";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { getEmailProvider } from "../notification-provider/service";
import { apiRouter, createRoute, jsonResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { normaliseTraceId } from "../permissions/shadow-middleware";
import { requireSessionOnly } from "../utils/require-session-only";
import {
  LOCAL_AUTH_METHOD_PLUGINS,
  LOCAL_AUTH_PORTALS,
  type LocalAuthMethodsRequest,
  localAuthMethodSetSchema,
  localAuthMethodsBody,
  localAuthMethodsRevisionSchema,
} from "./auth-local-methods-schema";
import {
  isCurrentInstanceAdmin,
  notifyCurrentInstanceAdminsOfAuditFailure,
} from "./observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "./observability/runtime";
import { requireCurrentInstanceAdmin } from "./require-instance-admin";

const PATH = "/api/instance/auth/local-methods";
const PLUGIN_IDS = LOCAL_AUTH_METHOD_PLUGINS.map(([pluginId]) => pluginId);
const PLUGIN_LABELS: Record<(typeof PLUGIN_IDS)[number], string> = {
  "auth.password": "Password",
  "auth.magic-link": "Magic link",
  "auth.email-otp": "Email code",
};

const errorSchema = z.object({ message: z.string() });
const methodsResponseSchema = z
  .object({
    agent: localAuthMethodSetSchema,
    customer: localAuthMethodSetSchema,
    emailProviderEnabled: z.boolean(),
    emailOtpDisabledByEnvironment: z.boolean(),
    revision: localAuthMethodsRevisionSchema,
  })
  .openapi("LocalAuthMethods");

const getRoute = createRoute({
  method: "get",
  operationId: "getLocalAuthMethods",
  path: "/instance/auth/local-methods",
  tags: ["Instance"],
  summary: "Get the local sign-in methods of the staff and customer portals",
  description:
    "Current instance administrators only, session-only. Returns the stored method flags per portal as the runtime resolves them, whether an email provider is enabled, and whether the environment switches email-code sign-in off. Never returns configuration values or secrets.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Local sign-in methods", methodsResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

const putRoute = createRoute({
  method: "put",
  operationId: "updateLocalAuthMethods",
  path: "/instance/auth/local-methods",
  tags: ["Instance"],
  summary: "Set the local sign-in methods of the staff and customer portals",
  description:
    "Current instance administrators only, elevated and session-only (PA-15 operation `auth_local_methods_update`, bound to all six flags). Staff password sign-in can never be disabled (R5), and email-code sign-in cannot be enabled while the environment switches it off: either request is refused with 422 before any proof is spent. The write stores one row per method and portal, retires any other stored row for these methods, audits the changed keys only and reloads authentication on every replica.",
  middleware: [requireSessionOnly()] as const,
  request: {
    headers: stepUpTokenHeader,
    body: {
      required: true,
      content: { "application/json": { schema: localAuthMethodsBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated local sign-in methods", methodsResponseSchema),
    403: jsonResponse("Forbidden or step-up unavailable", errorSchema),
    409: jsonResponse(
      "The stored methods changed since they were read",
      errorSchema,
    ),
    422: jsonResponse(
      "Staff password sign-in cannot be disabled, or email code cannot be enabled in this environment",
      errorSchema,
    ),
  },
});

type StoredRow = Pick<
  typeof schema.instancePluginConfigTable.$inferSelect,
  | "id"
  | "pluginId"
  | "instanceKey"
  | "enabled"
  | "scope"
  | "workspaceId"
  | "portalScope"
  | "configVersion"
>;

async function readLocalMethodRows(
  executor: Executor,
  options: { lock: boolean },
): Promise<StoredRow[]> {
  const query = executor
    .select({
      id: schema.instancePluginConfigTable.id,
      pluginId: schema.instancePluginConfigTable.pluginId,
      instanceKey: schema.instancePluginConfigTable.instanceKey,
      enabled: schema.instancePluginConfigTable.enabled,
      scope: schema.instancePluginConfigTable.scope,
      workspaceId: schema.instancePluginConfigTable.workspaceId,
      portalScope: schema.instancePluginConfigTable.portalScope,
      configVersion: schema.instancePluginConfigTable.configVersion,
    })
    .from(schema.instancePluginConfigTable)
    .where(inArray(schema.instancePluginConfigTable.pluginId, PLUGIN_IDS));
  return options.lock ? await query.for("update") : await query;
}

/**
 * Every stored row's own counter, sorted by id (as `authConfigurationVersion` does): any insert,
 * update or retirement changes it, and an unrelated larger counter cannot hide a change.
 */
function revisionOf(rows: readonly StoredRow[]): string {
  const pairs = rows
    .map((row) => [row.id, row.configVersion] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
}

function storedMethods(rows: readonly AuthPluginConfigRow[]) {
  return {
    agent: resolveStoredLocalAuthProviders("agent", rows),
    customer: resolveStoredLocalAuthProviders("customer", rows),
  };
}

async function methodsResponse(rows: readonly StoredRow[]) {
  const methods: {
    agent: LocalAuthProviders;
    customer: LocalAuthProviders;
  } = storedMethods(rows);
  const emailProvider = await getEmailProvider();
  return {
    agent: methods.agent,
    customer: methods.customer,
    emailProviderEnabled: emailProvider.enabled,
    emailOtpDisabledByEnvironment: isEmailOtpSignInDisabledByEnvironment(),
    revision: revisionOf(rows),
  };
}

type MethodsByPortal = Pick<LocalAuthMethodsRequest, "agent" | "customer">;

/** The changed `portal.method` keys, never their values (AU-2, `plugin.changed`). */
function changedKeys(
  before: MethodsByPortal,
  after: MethodsByPortal,
): string[] {
  return LOCAL_AUTH_PORTALS.flatMap((portal) =>
    LOCAL_AUTH_METHOD_PLUGINS.flatMap(([, key]) =>
      before[portal][key] === after[portal][key] ? [] : [`${portal}.${key}`],
    ),
  );
}

class LocalMethodsVerificationError extends Error {
  constructor() {
    super("local_auth_methods_verification_failed");
  }
}

class LocalMethodsConflictError extends Error {
  constructor() {
    super("version_conflict");
  }
}

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    if (portalForHost(c.req.header("host")) !== "agent") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(c, "GET", PATH);
    const rows = await readLocalMethodRows(db, { lock: false });
    setShadowLegacyAuthorization(c, "allowed");
    return c.json(await methodsResponse(rows), 200);
  })
  .openapi(putRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    if (portalForHost(c.req.header("host")) !== "agent") {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    await requireCurrentInstanceAdmin(c, "PUT", PATH);
    const userId = c.get("userId") as string;
    const session = c.get("session") as {
      id: string;
      impersonatedBy?: string | null;
    } | null;
    if (
      !session ||
      session.impersonatedBy ||
      !(await isCurrentInstanceAdmin(userId))
    ) {
      setShadowLegacyAuthorization(c, "denied");
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const requested = c.req.valid("json");
    // R5: staff password is the break-glass sign-in. Refused before any proof is spent.
    if (!requested.agent.password) {
      setShadowLegacyAuthorization(c, "allowed");
      return c.json({ message: "agent_password_required" }, 422);
    }
    // DISABLE_EMAIL_OTP_SIGN_IN keeps the email-code plugin unmounted on both hosts, so storing
    // it as enabled would advertise a method that cannot work. Refused before any proof is spent.
    if (
      isEmailOtpSignInDisabledByEnvironment() &&
      (requested.agent.emailOtp || requested.customer.emailOtp)
    ) {
      setShadowLegacyAuthorization(c, "allowed");
      return c.json({ message: "email_otp_disabled_by_environment" }, 422);
    }
    const [actor] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1);
    const traceId = normaliseTraceId(c.req.header("x-request-id"));

    let result: { written: number; auditOk: boolean };
    try {
      result = await runWithStepUp(
        c,
        { operation: AUTH_LOCAL_METHODS_UPDATE_OPERATION, ...requested },
        (spend) =>
          db.transaction(async (tx) => {
            // One writer at a time; the row locks then cover every existing row.
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext('taskdesk:auth-local-methods'), 0)`,
            );
            const rows = await readLocalMethodRows(tx, { lock: true });
            // Another administrator saved since this request's read: refuse before the
            // proof is spent, so nothing is overwritten silently and no proof is burned.
            if (revisionOf(rows) !== requested.expectedRevision)
              throw new LocalMethodsConflictError();
            const before = storedMethods(rows);
            await spend(tx);

            const now = new Date();
            let retired = 0;
            let written = 0;
            for (const [pluginId, key] of LOCAL_AUTH_METHOD_PLUGINS) {
              for (const portal of LOCAL_AUTH_PORTALS) {
                const enabled = requested[portal][key];
                const canonical = rows.find(
                  (row) =>
                    row.pluginId === pluginId && row.instanceKey === portal,
                );
                if (!canonical) {
                  await tx.insert(schema.instancePluginConfigTable).values({
                    id: createId(),
                    pluginId,
                    instanceKey: portal,
                    displayName: `${PLUGIN_LABELS[pluginId]} (${portal === "agent" ? "staff" : "customer"})`,
                    enabled,
                    config: {},
                    scope: "instance",
                    workspaceId: null,
                    portalScope: portal,
                    configVersion: 1,
                    updatedBy: actor?.id ?? null,
                  });
                  written += 1;
                  continue;
                }
                if (
                  canonical.enabled === enabled &&
                  canonical.scope === "instance" &&
                  canonical.workspaceId === null &&
                  canonical.portalScope === portal
                )
                  continue;
                await tx
                  .update(schema.instancePluginConfigTable)
                  .set({
                    enabled,
                    scope: "instance",
                    workspaceId: null,
                    portalScope: portal,
                    configVersion: canonical.configVersion + 1,
                    updatedAt: now,
                    updatedBy: actor?.id ?? null,
                  })
                  .where(eq(schema.instancePluginConfigTable.id, canonical.id));
                written += 1;
              }
              // Any other enabled row for this method (an older `both` row, a hand-inserted
              // row with another key) would still switch the method on through the runtime's
              // "any enabled row" rule. It is kept, but disabled, so the canonical rows decide.
              for (const row of rows) {
                if (
                  row.pluginId !== pluginId ||
                  (LOCAL_AUTH_PORTALS as readonly string[]).includes(
                    row.instanceKey,
                  ) ||
                  !row.enabled
                )
                  continue;
                await tx
                  .update(schema.instancePluginConfigTable)
                  .set({
                    enabled: false,
                    configVersion: row.configVersion + 1,
                    updatedAt: now,
                    updatedBy: actor?.id ?? null,
                  })
                  .where(eq(schema.instancePluginConfigTable.id, row.id));
                written += 1;
                retired += 1;
              }
            }

            // The runtime must read exactly the requested state, and staff password must hold.
            const after = await readLocalMethodRows(tx, { lock: false });
            let resolved: ReturnType<typeof storedMethods>;
            try {
              resolved = {
                agent: resolveLocalAuthProviders("agent", after),
                customer: resolveLocalAuthProviders("customer", after),
              };
            } catch {
              throw new LocalMethodsVerificationError();
            }
            if (changedKeys(resolved, requested).length > 0)
              throw new LocalMethodsVerificationError();

            const changed = changedKeys(before, requested);
            let auditOk = true;
            if (written > 0) {
              try {
                await tx.transaction(async (auditTx) => {
                  await appendAuditLog(auditTx, {
                    action: "plugin.changed",
                    actorId: userId,
                    actorType: "person",
                    traceId,
                    workspaceId: null,
                    entityType: "instance_plugin_config",
                    entityId: "auth.local-methods",
                    after: {
                      pluginIds: [...PLUGIN_IDS],
                      changedKeys: changed,
                      retiredRows: retired,
                    },
                  });
                });
              } catch {
                auditOk = false;
              }
            }
            return { written, auditOk };
          }),
      );
    } catch (error) {
      if (error instanceof LocalMethodsConflictError) {
        setShadowLegacyAuthorization(c, "allowed");
        return c.json({ message: "version_conflict" }, 409);
      }
      if (error instanceof LocalMethodsVerificationError)
        throw new HTTPException(500, {
          message: "Sign-in methods could not be saved",
        });
      setShadowLegacyAuthorization(c, "denied");
      throw error;
    }

    if (result.written > 0) await publishCommittedAuthConfigurationReload();
    if (!result.auditOk) {
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
    setShadowLegacyAuthorization(c, "allowed");
    const rows = await readLocalMethodRows(db, { lock: false });
    return c.json(await methodsResponse(rows), 200);
  });

export default routes;
