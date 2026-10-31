import { statSync } from "node:fs";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { normaliseRouteKey } from "@taskdesk/permissions";
import type { Session, User } from "better-auth/types";
import { sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { WebSocketServer } from "ws";
import activity from "./activity";
import agile from "./agile";
import apiKey from "./api-key";
import approval from "./approval";
import attachment from "./attachment";
import audit from "./audit";
import {
  assertCookieDomainIsNotConfiguredForHostIsolation,
  authForHost,
  hasCustomerPortalIdentity,
  isCustomerInviteSignUpEndpoint,
  isCustomerLocalAuthEndpoint,
  portalForHost,
  startAuthConfigRuntime,
  stopAuthConfigRuntime,
} from "./auth";
import csrfToken, { portalCsrfToken } from "./auth/csrf-token-api";
import factorStatus from "./auth/factor-status-api";
import { runWithImpersonator } from "./auth/impersonation-context";
import {
  InactiveFactorIdentityError,
  loadLocalFactorState,
} from "./auth/local-factor-service";
import stepUp from "./auth/step-up-api";
import automation from "./automation";
import cannedResponse from "./canned-response";
import capabilities from "./capabilities";
import column from "./column";
import comment from "./comment";
import config from "./config";
import customField from "./custom-field";
import customFieldSections from "./custom-field/sections";
import customerInvitation from "./customer-invitation";
import {
  acceptContinuation,
  publicContinuation,
} from "./customer-invitation/auth-continuation";
import portalAuthMethods from "./customer-invitation/auth-methods";
import { customerInvitationDeliveryKeyring } from "./customer-invitation/delivery/keyring";
import { purgeExpiredCustomerInvitationEnvelopes } from "./customer-invitation/delivery/repository";
import {
  closeMigrationPool,
  getDatabase,
  getMigrationDatabase,
  getMigrationDatabasePool,
} from "./database";
import { assertApplicationRoleIsNotPrivileged } from "./database/assert-application-role-is-not-privileged";
import { assertNoMigrationUrlInApiProcess } from "./database/assert-no-migration-url-in-api-process";
import { ensureApplicationRole } from "./database/ensure-application-role";
import { migrateWithMembershipProvenanceCutover } from "./database/migrate-membership-provenance";
import { prepareDatabaseStartup } from "./database/prepare-database-startup";
import { resolveMigrationDatabaseConfig } from "./database/resolve-database-url";
import { waitForDatabase } from "./database/wait-for-database";
import { eventContext } from "./events";
import externalLink from "./external-link";
import featureFlag from "./feature-flag";
import {
  customerPortalStateForSubmission,
  customerPortalStateForUser,
  type FeatureLookupState,
  featureStateSomewhere,
} from "./feature-flag/enforce";
import { accountLinkApi as accountLinkRouter } from "./identity/account-link";
import identityConnectionAdmin from "./identity/connection-admin";
import identityConnectionDeletion from "./identity/connection-deletion";
import { createHomeRealmApi } from "./identity/home-realm";
import { oidcGroupMappingAdminRouter } from "./identity/oidc-group-mapping-admin";
import scimAdmin from "./identity/scim-admin";
import scimProtocol from "./identity/scim-protocol";
import { createImportRouter } from "./imports";
import { requestImportChunkApproval } from "./imports/pending-action";
import authLocalMethods from "./instance/auth-local-methods";
import getInstanceStatus from "./instance/controllers/get-instance-status";
import instanceDeliveries from "./instance/deliveries";
import instanceDeliveryRequeue from "./instance/deliveries/requeue";
import instanceHealth from "./instance/health";
import impersonation from "./instance/impersonation";
import {
  enforceImpersonationRestrictions,
  impersonationMayCallAuthEndpoint,
} from "./instance/impersonation/guard";
import instanceJobs from "./instance/jobs";
import localFactorPolicy from "./instance/local-factor-policy";
import instanceMcpUsage from "./instance/mcp-usage";
import observability from "./instance/observability";
import {
  logDatabaseFailure,
  logHttpLifecycleFailure,
  logHttpRequestFailure,
} from "./instance/observability/http-lifecycle";
import metricsTokenRotation from "./instance/observability/metrics-token-rotation";
import {
  beginObservedRequest,
  logTaskDesk,
  observeRequest,
  startObservabilityRuntime,
  stopObservabilityRuntime,
} from "./instance/observability/runtime";
import organisationCatalogue from "./instance/organisation-catalogue";
import organisationCustomerVisibility from "./instance/organisation-customer-visibility";
import organisationLifecycle from "./instance/organisation-lifecycle";
import instancePlugins from "./instance/plugins";
import hardPurge from "./instance/purge";
import resetMfa from "./instance/reset-mfa";
import rotateSecrets from "./instance/secrets/rotate-secrets";
import instanceSettings from "./instance/settings";
import { ensureSetupToken } from "./instance/setup-token";
import instanceStorage from "./instance/storage";
import users from "./instance/users";
import intake from "./intake";
import { requestTypeGroupOrderRouter } from "./intake/group-order";
import {
  intakeQueueReadRouter,
  intakeQueueRunRouter,
  intakeQueueWriteRouter,
} from "./intake/queues/router";
import invitation from "./invitation";
import kb from "./kb";
import label from "./label";
import mcpTelemetry from "./mcp-telemetry";
import meIdentity from "./me-identity";
import {
  apiBodyLimitMiddleware,
  BodyLimitError,
} from "./middleware/body-limits";
import { idempotencyKeyMiddleware } from "./middleware/idempotency";
import { createPostgresIdempotencyStore } from "./middleware/idempotency.repository";
import { migrateColumns } from "./migrations/column-migration";
import notification from "./notification";
import portalCanonicalPreferences from "./notification/portal-canonical-preferences";
import portalNotificationRouter from "./notification/portal-inbox";
import { portalNotificationPolicies } from "./notification/portal-inbox-policy";
import { createPortalNotificationWebSocket } from "./notification/portal-inbox-websocket";
import {
  authenticatedPreferenceHandoff,
  publicPreferenceHandoff,
} from "./notification/preference-handoff";
import notificationPreferences from "./notification-preferences";
import notificationProvider from "./notification-provider";
import { installRuntimeSmtpResolver } from "./notification-provider/runtime";
import oauth from "./oauth";
import { createRoute, errorResponse, jsonResponse, z } from "./openapi";
import pages from "./pages";
import pendingAction from "./pending-action";
import {
  type ExplicitCredentialMutation,
  isCredentialRevocationFailure,
  withAccountDeletionTransaction,
  withExplicitCredentialMutation,
  withTotpSessionEnrollment,
} from "./pending-action/credential-invalidation";
// Issue #8: `assertRouteIsClassified` refuses a request whose route has no policy entry at
// all (presence only, always on); `runNextWithPolicyShadow` is the shadow-mode ALLOW/DENY
// comparison, off by default. See the call sites below and each file's own header comment.
import { assertRouteIsClassified } from "./permissions/route-classification-guard";
import {
  ensurePolicyRequestId,
  setShadowLegacyAuthorization,
  strictPolicyWitness,
} from "./permissions/shadow-context";
import {
  declareCatchAllMiddleware,
  runNextWithPolicyShadow,
} from "./permissions/shadow-middleware";
import { installStrictPolicyRegistration } from "./permissions/strict-route-registration";
import { initializePlugins } from "./plugins";
// Importing this constructs and validates the registry at module load, so an invalid policy
// refuses boot (#8 Slice 0). Keep the import even if its one use below moves: without a use,
// the bundler drops it and the check silently stops running.
import { policyRegistry } from "./policy-registry";
import { isPortalClientRoute } from "./portal-client-routes";
import project, { projectStates } from "./project";
import { projectOverviewApi as projectOverview } from "./project/overview";
import { projectSettingsInheritanceApi as projectSettingsInheritance } from "./project/settings-inheritance";
import report from "./report";
import {
  parseTaskDeskRole,
  roleOwnsGeneralJobs,
  roleOwnsHttp,
  type ServingRole,
  startJobLivenessServer,
} from "./runtime-role";
import { initializeScheduler, shutdownScheduler } from "./scheduler";
import { recoverDensePositionPartitions } from "./scheduler/position-rebalance";
import search from "./search";
import {
  applyPdfPreviewAssetResponseHeaders,
  createSecurityHeadersMiddleware,
  cspNonceForContext,
  cspReportApi,
  injectCspNonceIntoHtmlResponse,
} from "./security-headers";
import serviceCalendar from "./service-calendar";
import serviceManagement from "./service-management";
import { portalReleaseRouter } from "./service-management/release-portal";
import slaPolicy from "./sla-policy";
import {
  getPrivateObject,
  getStorageBrowserOrigins,
  getStorageDriver,
} from "./storage";
import { buildContentDisposition } from "./storage/content-disposition";
import {
  readAttachmentDownloadObject,
  StoragePathError,
  writeAttachmentUploadedObject,
  writeUploadedObject,
} from "./storage/filesystem";
import task, { taskV2 } from "./task";
import taskRelation from "./task-relation";
import team from "./team";
import {
  instanceTerminology,
  portalTerminology,
  publicTerminology,
  workspaceTerminology,
} from "./terminology";
import timeEntry from "./time-entry";
import timeTracking from "./time-tracking";
import user from "./user";
import getAvatar from "./user/controllers/get-avatar";
import userPreference from "./user-preference";
import { buildAuthRequest } from "./utils/auth-request";
import {
  authenticateApiRequest,
  hasInvalidExplicitCredential,
  resolveOptionalCookieSession,
} from "./utils/authenticate-api-request";
import {
  type ReachableAsset,
  requireAssetProjectReach,
} from "./utils/authorize-asset-access";
import { backfillWorkspaceAndProjectDefaults } from "./utils/backfill-workspace-project-defaults";
import { getInvitationDetails } from "./utils/check-registration-allowed";
import { csrfProtectionMiddleware } from "./utils/csrf-protection";
import { requireAnonymousInvitationRateLimit } from "./utils/invitation-anonymous-rate-limit";
import { migrateApiKeyReferenceId } from "./utils/migrate-apikey-reference-id";
import { migrateNotificationPreferencesSchema } from "./utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "./utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "./utils/migrate-workspace-user-email";
import { normalizeApiServerUrl } from "./utils/openapi-spec";
import { rejectNulByte } from "./utils/reject-nul-byte";
import {
  parseConfiguredOrigins,
  publicOriginForKind,
  selectOriginFromContext,
} from "./utils/request-origin";
import {
  assertCallerHasCapability,
  capabilityCredential,
} from "./utils/require-workspace-capability";
import {
  seedCanonicalWorkspaceRoles,
  seedDefaultWorkspaceRoles,
} from "./utils/seed-default-workspace-roles";
import { seedInternalOrganisationAndStaffPersons } from "./utils/seed-internal-organisation";
import view from "./view";
import webhook from "./webhook";
import webhookRotateAll from "./webhook/rotate-all-api";
import webhookSecurityPosture from "./webhook/security-posture";
import workItem from "./work-item";
import { combinedWorkItemRouter } from "./work-item/combined-router";
import workItemCommentVersions from "./work-item/comment-versions";
import workItemRelation from "./work-item-relation";
import workflow from "./workflow";
import workflowRule from "./workflow-rule";
import workspace from "./workspace";
import workspaceProjectSettings from "./workspace/project-settings";
import { reconcileWorkspaceAdminReach } from "./workspace/workspace-admin-reach";
import {
  type addConnection,
  addConnectionWithinLimit,
  addNativeConnection,
  addUserConnection,
  forceShutdownWebSocketAdapter,
  handleNativeFrame,
  initializeWebSocketAdapter,
  removeConnection,
  removeNativeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
  startInboxRealtimeListener,
} from "./ws";
import {
  callerReachesLegacySocketProject,
  requireLegacySocketProjectReach,
} from "./ws/legacy-project-reach";
import { logRealtimeFailure } from "./ws/log-realtime-failure";
import { checkWebSocketOrigin } from "./ws/origin-policy";

type ApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
  isMcp?: boolean;
};

type AppVariables = {
  Bindings: { incoming?: IncomingMessage & { authority?: string } };
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    apiKey?: ApiKey;
    appOrigin: "agent" | "portal" | "unknown";
    appPublicOrigin?: string;
    /** Set on the portal host while `feature.customer_portal` is not on (P3-R2-03, P4R2-L1). */
    portalFeatureState?: PortalFeatureOffState;
  };
};

type ApiVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    userEmail: string;
    apiKey?: ApiKey;
  };
};

async function enforceLocalFactorEnrollment(c: Context<ApiVariables>) {
  if (c.req.path === "/api/me/security/factors") return;
  const userId = c.get("userId");
  const session = c.get("session") as (Session & { portal?: string }) | null;
  if (!userId || !session || session.portal !== "agent") return;

  let state: Awaited<ReturnType<typeof loadLocalFactorState>>;
  try {
    state = await loadLocalFactorState(userId);
  } catch (error) {
    // Inactive identities are denied by authorization, not treated as a broken
    // factor-policy store. Keep missing identities and policy/database failures
    // fail-closed as unavailable.
    if (error instanceof InactiveFactorIdentityError) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
    throw new HTTPException(503, { message: "factor_policy_unavailable" });
  }
  if (state.required && !state.enabled) {
    throw new HTTPException(403, { message: "mfa_enrollment_required" });
  }
}

const SAFE_INLINE_ASSET_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/**
 * Where the built web app can be found, relative to this module's own file
 * rather than `process.cwd()` — the process is started from a different
 * working directory in every environment that matters:
 *
 *  - Production (the shipped Dockerfile): `node apps/api/dist/index.js` runs
 *    from `WORKDIR /app`, and the web bundle is copied to `/app/public`
 *    (see docs/05-operations/container-image.md and the Dockerfile's
 *    `runtime` stage) — three directories up from the bundled file, then
 *    into `public`.
 *  - Local dev/build (`tsx watch` on `src/index.ts`, or a plain `node
 *    apps/api/dist/index.js` run outside the image): the web app is still at
 *    its ordinary monorepo location, `apps/web/dist` — two directories up
 *    from either `apps/api/src` or `apps/api/dist`, then into `web/dist`.
 *
 * Both candidates are checked in order; the first that looks like a real
 * build (a directory containing `index.html`) wins.
 */
function defaultStaticRootCandidates(surface: "agent" | "portal"): string[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
    join(currentDir, "../../../public", surface),
    join(currentDir, `../../web/dist/${surface}`),
  ];
}

/**
 * Resolves the directory the built web app should be served from, or
 * `undefined` when none of the candidates look like a real build (missing
 * entirely, or present without an `index.html`). Exported so a test can pass
 * its own fixture directory instead of depending on `apps/web/dist` actually
 * having been built.
 */
export function resolveStaticRoot(
  candidates: string[] = defaultStaticRootCandidates("agent"),
): string | undefined {
  return candidates.find((candidate) => {
    try {
      return (
        statSync(candidate).isDirectory() &&
        statSync(join(candidate, "index.html")).isFile()
      );
    } catch {
      return false;
    }
  });
}

function isApiRequestPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

const CUSTOMER_AUTH_ENDPOINTS = new Set([
  "GET /api/auth/get-session",
  "POST /api/auth/sign-out",
  "POST /api/auth/two-factor/verify-totp",
  "POST /api/auth/two-factor/verify-backup-code",
  "POST /api/portal/sign-in/home-realm",
  "GET /api/portal/sign-in/home-realm/start",
]);
const PORTAL_HOME_REALM_ENDPOINTS = new Set([
  "POST /api/portal/sign-in/home-realm",
  "GET /api/portal/sign-in/home-realm/start",
]);
const PORTAL_CANONICAL_PREFERENCE_ENDPOINTS = new Set([
  "GET /api/portal/notification-preferences/canonical",
  "PUT /api/portal/notification-preferences/canonical",
]);

function routeKeyMatchesRequest(
  routeKey: string,
  method: string,
  path: string,
) {
  const separator = routeKey.indexOf(" ");
  if (separator < 0 || routeKey.slice(0, separator) !== method) return false;
  const expected = routeKey.slice(separator + 1).split("/");
  const actual = path.split("/");
  return (
    expected.length === actual.length &&
    expected.every((part, index) =>
      /^\{[^/]+\}$/u.test(part)
        ? Boolean(actual[index])
        : part === actual[index],
    )
  );
}

function matchesPortalPolicyRoute(method: string, path: string): boolean {
  return policyRegistry.entries.some(
    (entry) =>
      entry.kind === "portal" &&
      routeKeyMatchesRequest(entry.routeKey, method, path),
  );
}

const PORTAL_INVITATION_AUTH_ROUTES = [
  "GET /api/portal/auth-methods",
  "POST /api/portal/invitations/{id}/continuation",
  "POST /api/portal/invitations/{id}/accept-continuation",
  "GET /api/portal/invitations/{id}/continuation-result",
] as const;
function matchesPortalInvitationAuthRoute(
  method: string,
  path: string,
): boolean {
  return PORTAL_INVITATION_AUTH_ROUTES.some((key) =>
    routeKeyMatchesRequest(key, method, path),
  );
}

function matchesPortalNotificationRoute(method: string, path: string): boolean {
  return Object.keys(portalNotificationPolicies).some((routeKey) =>
    routeKeyMatchesRequest(routeKey, method, path),
  );
}

/**
 * CP-19 carve-out: the filesystem driver's signed upload/download routes are admitted on
 * the portal host ONLY for portal submission attachment objects. Presign (a `kind: portal`
 * route) mints a URL on the requesting origin, so without this a customer's presigned PUT
 * or download redirect would hit the portal host's blanket `/api` denial. The handler still
 * verifies the HMAC token that binds the exact key, size ceiling and expiry; no session
 * is involved. Agent/work-item keys (`.../work-item/...`) and any other key shape stay
 * denied by host, and every other agent route stays unreachable.
 */
const PORTAL_SUBMISSION_ATTACHMENT_KEY =
  /^workspace\/[A-Za-z0-9_-]+\/submission\/[A-Za-z0-9_-]+\/attachment\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/u;
/**
 * `complete` moves the object to `<pending dir>/final/<cuid2 token>-<file>`
 * (`toFinalAttachmentObjectKey`), and the attachment row then points at that key, so a
 * download redirect carries it. Downloads only: nothing ever mints an upload token for a
 * finalized key.
 */
const PORTAL_SUBMISSION_FINAL_ATTACHMENT_KEY =
  /^workspace\/[A-Za-z0-9_-]+\/submission\/[A-Za-z0-9_-]+\/attachment\/[A-Za-z0-9_-]+\/final\/[a-z0-9]+-[A-Za-z0-9_.-]+$/u;

function isPortalSubmissionStorageRequest(
  method: string,
  path: string,
  key: string | undefined,
): boolean {
  if (key === undefined || key.includes("..")) return false;
  if (method === "PUT" && path === "/api/storage/filesystem-attachment-upload")
    return PORTAL_SUBMISSION_ATTACHMENT_KEY.test(key);
  if (
    (method === "GET" || method === "HEAD") &&
    path === "/api/storage/filesystem-download"
  )
    return (
      PORTAL_SUBMISSION_ATTACHMENT_KEY.test(key) ||
      PORTAL_SUBMISSION_FINAL_ATTACHMENT_KEY.test(key)
    );
  return false;
}

function isCustomerAuthEndpoint(method: string, path: string): boolean {
  if (CUSTOMER_AUTH_ENDPOINTS.has(`${method} ${path}`)) return true;
  if (isCustomerLocalAuthEndpoint(method, path)) return true;
  if (isCustomerInviteSignUpEndpoint(method, path)) return true;
  if (method !== "GET") return false;
  const parts = path.split("/");
  return (
    parts.length === 6 &&
    parts[1] === "api" &&
    parts[2] === "auth" &&
    parts[3] === "identity" &&
    Boolean(parts[4]) &&
    // The portal's only SSO entry is the typed-domain home-realm flow; a direct
    // connection start is agent-host only. The provider's redirect back stays admitted.
    parts[5] === "callback"
  );
}

function authForRequest(c: Context) {
  const selected = authForHost(c.req.header("Host"));
  if (!selected) throw new HTTPException(403, { message: "Forbidden" });
  return selected;
}

async function handleAuthRequest(
  c: Context,
  headers?: Headers,
  mutation?: ExplicitCredentialMutation,
) {
  if (
    hasInvalidExplicitCredential(
      c.req.header("Authorization"),
      c.req.header("x-api-key"),
    )
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const host = c.req.header("Host");
  const portal = portalForHost(host);
  const selected = authForRequest(c);
  if (!portal) throw new HTTPException(403, { message: "Forbidden" });

  const session = await selected.api.getSession({
    headers: c.req.raw.headers,
  });
  if (
    session?.session &&
    (session.session.portal !== portal ||
      (portal === "customer" &&
        !(await hasCustomerPortalIdentity(session.user.id))))
  ) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  // GM-9: an impersonation session may not change credentials, factors, keys or the account
  // through Better Auth; it may only read and sign out.
  if (
    (session?.session as { impersonatedBy?: string | null } | undefined)
      ?.impersonatedBy &&
    !impersonationMayCallAuthEndpoint(c.req.method, c.req.path)
  ) {
    throw new HTTPException(403, {
      message:
        "impersonation: this action is not allowed during an impersonation session",
    });
  }

  const accountDeletionRoute =
    (c.req.method === "POST" && c.req.path === "/api/auth/delete-user") ||
    (c.req.method === "GET" && c.req.path === "/api/auth/delete-user/callback");
  if (accountDeletionRoute) {
    const requestTemplate = c.req.raw.clone();
    return withAccountDeletionTransaction(() =>
      selected.handler(buildAuthRequest(c, headers, requestTemplate.clone())),
    );
  }
  const authRequest = buildAuthRequest(c, headers);
  if (
    c.req.method === "POST" &&
    c.req.path === "/api/auth/two-factor/verify-totp"
  ) {
    try {
      return await withTotpSessionEnrollment(() =>
        selected.handler(authRequest),
      );
    } catch (error) {
      if (isCredentialRevocationFailure(error)) {
        return c.json({ error: "credential_revocation_failed" }, 503);
      }
      throw error;
    }
  }
  if (!mutation) return selected.handler(authRequest);

  const outcome = await withExplicitCredentialMutation(mutation, () =>
    selected.handler(authRequest),
  );
  if (outcome.state.deleteFailure) {
    return c.json({ error: "credential_revocation_failed" }, 503);
  }
  return outcome.result;
}

function explicitAuthCredentialMutation(
  method: string,
  path: string,
  body?: unknown,
): ExplicitCredentialMutation | undefined {
  if (method !== "POST" || !path.startsWith("/api/auth/")) return undefined;
  const route = path.slice("/api/auth".length);
  if (route === "/api-key/delete" || route === "/api-key/update") {
    return { kind: "api_key", route };
  }
  if (
    route === "/sign-out" ||
    route === "/revoke-session" ||
    route === "/revoke-sessions" ||
    route === "/revoke-other-sessions"
  ) {
    return { kind: "session", route };
  }
  if (
    route === "/change-password" &&
    typeof body === "object" &&
    body !== null &&
    "revokeOtherSessions" in body &&
    body.revokeOtherSessions === true
  ) {
    return { kind: "session", route };
  }
  return undefined;
}

async function explicitAuthCredentialMutationForRequest(
  method: string,
  path: string,
  request: Request,
): Promise<ExplicitCredentialMutation | undefined> {
  if (method !== "POST" || path !== "/api/auth/change-password") {
    return explicitAuthCredentialMutation(method, path);
  }
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return undefined;
  }
  return explicitAuthCredentialMutation(method, path, body);
}

/**
 * Serves the built web app, if one is found, so the API process alone can
 * answer a real UAT deployment: real files served from disk with their real
 * content-type, and any unmatched non-API GET falls back to `index.html` so
 * client-side routing survives a hard refresh or a direct URL.
 *
 * Deliberately a no-op when no build is found (dev environments that only
 * run the API) rather than throwing — see `resolveStaticRoot`'s log line,
 * which fires exactly once, at startup, in that case.
 *
 * A request path under `/api` is never touched here, matched or not — that
 * surface keeps its own routing and its own 404s, unconditionally.
 *
 * This catch-all registration is unconditional, even when neither build exists on disk. The
 * middleware returns 503 for document requests to a surface without a build and leaves API
 * paths to their own routing. Keeping the registration unconditional preserves the exact
 * six-entry `"ALL /*"` count declared by `packages/permissions` in
 * `DECLARED_ROUTER_MIDDLEWARE` for both built and API-only environments.
 */
function resolveStaticRoots(options: {
  agent?: string;
  portal?: string;
}): Record<"agent" | "portal", string | undefined> {
  return {
    agent: resolveStaticRoot(
      options.agent ? [options.agent] : defaultStaticRootCandidates("agent"),
    ),
    portal: resolveStaticRoot(
      options.portal ? [options.portal] : defaultStaticRootCandidates("portal"),
    ),
  };
}

function denyByHost(c: Context<AppVariables>) {
  if (isApiRequestPath(c.req.path)) {
    return c.req.method === "HEAD"
      ? c.body(null, 404, { "content-type": "application/json" })
      : c.json({ message: "Not Found" }, 404);
  }
  return c.body(null, 404);
}

/**
 * Build output under `/assets/` is named `[name]-[hash][extname]` (apps/web/vite.config.ts), so
 * its bytes never change under the same URL: browsers and the CDN may keep it for a year without
 * revalidating. HTML shells stay `no-store` (security-headers middleware), and anything without
 * a content hash (root `public/` files such as the favicon and web manifest) keeps the default.
 */
const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";
const CONTENT_HASHED_ASSET_PATH =
  /^\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/u;

export function isContentHashedAssetPath(path: string): boolean {
  return CONTENT_HASHED_ASSET_PATH.test(path);
}

function staticFileServers(root: string) {
  return {
    serveAsset: serveStatic({ root }),
    serveIndex: serveStatic({ root, path: "/index.html" }),
  };
}

/**
 * Serves the separate built app selected by the validated request authority.
 * A missing selected root returns 503; it never falls back across origins.
 */
function registerStaticServing(
  app: Hono<AppVariables>,
  staticRoots: Record<"agent" | "portal", string | undefined>,
) {
  if (!staticRoots.agent && !staticRoots.portal) {
    console.warn(
      "[static] No built web apps found; both origin roots return 503 for document requests until their builds exist.",
    );
  }
  for (const [surface, staticRoot] of Object.entries(staticRoots)) {
    if (staticRoot)
      console.log(`[static] Serving the ${surface} app from ${staticRoot}`);
  }
  // One file server per built app, created once rather than per request.
  const servers = {
    agent: staticRoots.agent ? staticFileServers(staticRoots.agent) : undefined,
    portal: staticRoots.portal
      ? staticFileServers(staticRoots.portal)
      : undefined,
  };

  const serveStaticOrSpaShell = async (
    c: Context<AppVariables>,
    next: Next,
  ) => {
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      isApiRequestPath(c.req.path)
    ) {
      return next();
    }

    const surface = c.get("appOrigin");
    if (surface !== "agent" && surface !== "portal") return next();
    const server = servers[surface];
    const portalOff =
      surface === "portal" ? c.get("portalFeatureState") : undefined;
    if (!server && portalOff)
      return portalFeatureOffResponse(c.req.path, portalOff);
    if (!server) {
      return c.req.method === "HEAD"
        ? c.body(null, 503, { "content-type": "application/json" })
        : c.json({ message: "Service Unavailable" }, 503);
    }

    const { serveAsset, serveIndex } = server;
    const serveNoncedHtml = (response: Response, nonce: string) => {
      // Hono merges the previous context headers into returned responses. Clear
      // file metadata here as well as in the transformed Response, or the old
      // byte count truncates the document after its nonce is added.
      c.header("Content-Length", undefined);
      c.header("ETag", undefined);
      c.header("Last-Modified", undefined);
      return injectCspNonceIntoHtmlResponse(response, nonce);
    };
    let assetMissing = false;
    const result = await serveAsset(c, async () => {
      assetMissing = true;
    });
    if (!assetMissing) {
      const assetResponse = applyPdfPreviewAssetResponseHeaders(
        result ?? c.res,
        c.req.path,
      );
      if (
        (assetResponse.status === 200 || assetResponse.status === 206) &&
        isContentHashedAssetPath(c.req.path)
      )
        assetResponse.headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE);
      const nonce = cspNonceForContext(c);
      const isHtml = assetResponse.headers
        .get("content-type")
        ?.startsWith("text/html");
      const htmlResponse =
        nonce && isHtml
          ? await serveNoncedHtml(assetResponse, nonce)
          : assetResponse;
      // "/" is served here as the directory index: mark it like the SPA fallback below.
      if (surface === "portal" && isHtml) {
        const offState = portalOff ?? (await customerPortalDocumentState(c));
        if (offState) return markPortalShell(htmlResponse, offState);
      }
      return htmlResponse;
    }
    const serveNoncedIndex = async () => {
      const response = await serveIndex(c, next);
      const nonce = cspNonceForContext(c);
      const shell = nonce
        ? await serveNoncedHtml(response ?? c.res, nonce)
        : response;
      if (surface !== "portal" || !shell) return shell;
      // P3-R2-03: a switched-off portal is still the portal app, which renders the
      // library-built feature-off state from this marker; never a hand-written page.
      const offState = portalOff ?? (await customerPortalDocumentState(c));
      return offState ? markPortalShell(shell, offState) : shell;
    };

    const lastSegment = c.req.path.split("/").pop() ?? "";
    if (lastSegment.includes(".")) return next();
    if (surface === "portal") {
      // CP-19: only registered portal client routes get the portal shell; never agent files.
      return isPortalClientRoute(c.req.path)
        ? serveNoncedIndex()
        : c.notFound();
    }
    return serveNoncedIndex();
  };
  declareCatchAllMiddleware(serveStaticOrSpaShell);
  app.use("*", serveStaticOrSpaShell);
}

type PortalFeatureOffState = Exclude<FeatureLookupState, "on">;

/** Seconds a client should wait before retrying while the portal flag cannot be read. */
const PORTAL_STATE_RETRY_AFTER_SECONDS = "5";

/**
 * The portal host while `feature.customer_portal` is off (404) or cannot be read (503,
 * "temporarily unavailable", fail closed; P4R2-L1). API calls get JSON; a document request
 * gets the portal app itself, which shows its feature-off state (P3-R2-03), so this response is
 * only used for API paths, non-GET requests and an installation without a portal build.
 */
function portalFeatureOffResponse(
  path: string,
  state: PortalFeatureOffState,
): Response {
  const unavailable = state === "unknown";
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(unavailable ? { "retry-after": PORTAL_STATE_RETRY_AFTER_SECONDS } : {}),
  };
  const status = unavailable ? 503 : 404;
  if (isApiRequestPath(path))
    return Response.json(
      { message: unavailable ? "temporarily_unavailable" : "Not found" },
      { status, headers },
    );
  return new Response(
    unavailable
      ? '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Customer portal temporarily unavailable</title></head><body><h1>Customer portal temporarily unavailable</h1><p>Please try again in a moment.</p></body></html>'
      : '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Customer portal unavailable</title></head><body><h1>Customer portal unavailable</h1><p>The customer portal is not enabled for this instance.</p></body></html>',
    {
      status,
      headers: { ...headers, "content-type": "text/html; charset=utf-8" },
    },
  );
}

/** The `<meta>` the portal app reads to show its feature-off state instead of signing in. */
const PORTAL_STATE_META_NAME = "taskdesk-portal-state";

/**
 * Marks the served portal shell as switched off ("disabled") or unreadable ("unavailable") and
 * gives it the matching status, so clients and monitoring can tell the two apart while the page
 * itself renders the library-built feature-off state.
 */
async function markPortalShell(
  response: Response,
  state: PortalFeatureOffState,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  const unavailable = state === "unknown";
  if (unavailable) headers.set("retry-after", PORTAL_STATE_RETRY_AFTER_SECONDS);
  const status = unavailable ? 503 : 404;
  if (
    response.body === null ||
    !headers.get("content-type")?.toLowerCase().startsWith("text/html")
  )
    return new Response(response.body, { status, headers });
  const meta = `<meta name="${PORTAL_STATE_META_NAME}" content="${unavailable ? "unavailable" : "disabled"}">`;
  const html = await response.text();
  const marked = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${meta}`)
    : /^\s*<!doctype[^>]*>/i.test(html)
      ? html.replace(/^\s*<!doctype[^>]*>/i, (doctype) => `${doctype}${meta}`)
      : `${meta}${html}`;
  return new Response(marked, { status, headers });
}

/**
 * The per-organisation `feature.customer_portal` state for a portal document request that
 * carries a customer session (P4R2-M2), so a customer whose organisation's workspaces have the
 * portal off sees the same feature-off state. No cookie, no session or a staff session: none.
 */
async function customerPortalDocumentState(
  c: Context<AppVariables>,
): Promise<PortalFeatureOffState | undefined> {
  if (!c.req.header("cookie")) return undefined;
  try {
    const session = await resolveOptionalCookieSession(c.req.raw.headers);
    if (!session?.user) return undefined;
    const state = await customerPortalStateForUser(session.user.id);
    return state === null || state === "on" ? undefined : state;
  } catch {
    return undefined;
  }
}

/**
 * Portal data routes that belong to a customer's organisation, gated per organisation (and per
 * submission) on `feature.customer_portal` (P4R2-M2). Sign-in, session, CSRF, terminology,
 * invitations and notification preferences stay open so the portal app can always load and show
 * its state.
 */
const PORTAL_FEATURE_DATA_PREFIXES = [
  "/api/portal/approvals",
  "/api/portal/catalogue",
  "/api/portal/kb",
  "/api/portal/releases",
  "/api/portal/requests",
  "/api/portal/submissions",
] as const;

function isPortalFeatureDataPath(path: string): boolean {
  return PORTAL_FEATURE_DATA_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

async function enforceCustomerPortalFeature(
  c: Context<ApiVariables>,
): Promise<Response | undefined> {
  if (!isPortalFeatureDataPath(c.req.path)) return undefined;
  const userId = c.get("userId");
  if (!userId) return undefined;
  let state = await customerPortalStateForUser(userId);
  if (state === null) return undefined;
  const submission =
    /^\/api\/portal\/submissions\/SUB-([1-9]\d{0,9})(?:\/|$)/.exec(c.req.path);
  if (state === "on" && submission?.[1])
    state = await customerPortalStateForSubmission(Number(submission[1]));
  return state === "on"
    ? undefined
    : portalFeatureOffResponse(c.req.path, state);
}

export function createApp(
  options: {
    staticRoot?: string;
    portalStaticRoot?: string;
    registerAdditionalRoutes?: (app: Hono<AppVariables>) => void;
  } = {},
) {
  installRuntimeSmtpResolver();
  assertCookieDomainIsNotConfiguredForHostIsolation();
  const app = new Hono<AppVariables>();

  const requestMetricsMiddleware = async (
    c: Context<AppVariables>,
    next: Next,
  ) => {
    const requestId = ensurePolicyRequestId(c);
    c.header("x-taskdesk-request-id", requestId);
    const startedAt = performance.now();
    const release = beginObservedRequest();
    try {
      await next();
    } finally {
      release();
      const routePath = c.req.routePath;
      let registeredRoute: string | undefined;
      if (routePath) {
        try {
          registeredRoute = normaliseRouteKey(`${c.req.method} ${routePath}`);
        } catch {
          registeredRoute = undefined;
        }
      }
      observeRequest({
        method: c.req.method,
        route: registeredRoute,
        status: c.res.status,
        durationMs: Math.max(0, performance.now() - startedAt),
        requestId,
        strictPolicyWitness: strictPolicyWitness(c) ?? undefined,
      });
    }
  };
  declareCatchAllMiddleware(requestMetricsMiddleware);
  app.use("*", requestMetricsMiddleware);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      // expected errors (401/404/...) are not reported; real failures are
      if (err.status >= 500) {
      }
      return err.getResponse();
    }
    return c.json({ message: "Internal Server Error" }, 500);
  });
  const staticRoots = resolveStaticRoots({
    agent: options.staticRoot,
    portal: options.portalStaticRoot,
  });
  const origins = parseConfiguredOrigins(
    process.env.TASKDESK_AGENT_URL,
    process.env.TASKDESK_PORTAL_URL,
  );
  const browserStorageOrigins = getStorageBrowserOrigins();
  const securityHeaders = createSecurityHeadersMiddleware({
    surfaceForContext: (c) => {
      const surface = c.get("appOrigin");
      return surface === "agent" || surface === "portal" ? surface : undefined;
    },
    origins: {
      agent: publicOriginForKind("agent", origins),
      portal: publicOriginForKind("portal", origins),
      storage: { agent: browserStorageOrigins, portal: browserStorageOrigins },
    },
    readCspMode: async () => {
      const result = await getDatabase().execute<{ mode: string }>(
        sql`SELECT csp_mode AS mode FROM instance_setting WHERE id = 'singleton' LIMIT 1`,
      );
      return result.rows[0]?.mode ?? "enforce";
    },
  });
  const hostRoutingGuard = async (c: Context<AppVariables>, next: Next) => {
    const selected = selectOriginFromContext(c, origins);
    const isHealthPath =
      c.req.path === "/api/health" ||
      c.req.path === "/api/public/health/live" ||
      c.req.path === "/api/public/health/ready";
    const isScimPath = c.req.path.startsWith("/scim/v2/");
    const isHealthRequest =
      isHealthPath && (c.req.method === "GET" || c.req.method === "HEAD");
    const upgrade = c.req.header("upgrade")?.toLowerCase();
    const connection = c.req.header("connection")?.toLowerCase() ?? "";
    const isWebSocketUpgrade =
      upgrade === "websocket" && connection.includes("upgrade");

    const isPortalNotificationSocket =
      c.req.method === "GET" && c.req.path === "/api/ws/portal/notification";
    const isPortalInvitationAuthRequest = matchesPortalInvitationAuthRoute(
      c.req.method,
      c.req.path,
    );
    const isPortalNotificationRequest = matchesPortalNotificationRoute(
      c.req.method,
      c.req.path,
    );
    if (selected === "invalid") return denyByHost(c);
    if (isScimPath && selected !== "agent") return denyByHost(c);
    if (
      isWebSocketUpgrade &&
      ((selected !== "agent" &&
        !(selected === "portal" && isPortalNotificationSocket)) ||
        isHealthPath)
    )
      return denyByHost(c);
    if (
      selected === "agent" &&
      (isPortalNotificationSocket ||
        isPortalNotificationRequest ||
        isPortalInvitationAuthRequest)
    )
      return denyByHost(c);
    if (isHealthRequest) {
      c.set("appOrigin", selected === "unknown" ? "unknown" : selected);
      if (selected !== "unknown") {
        c.set("appPublicOrigin", publicOriginForKind(selected, origins));
      }
      await securityHeaders(c, next);
      if (c.req.method === "HEAD")
        return new Response(null, {
          status: c.res.status,
          statusText: c.res.statusText,
          headers: c.res.headers,
        });
      return;
    }
    if (selected === "unknown") return denyByHost(c);
    c.set("appOrigin", selected);
    c.set("appPublicOrigin", publicOriginForKind(selected, origins));
    if (
      selected === "agent" &&
      (PORTAL_HOME_REALM_ENDPOINTS.has(`${c.req.method} ${c.req.path}`) ||
        PORTAL_CANONICAL_PREFERENCE_ENDPOINTS.has(
          `${c.req.method} ${c.req.path}`,
        ))
    )
      return denyByHost(c);
    if (selected === "portal") {
      // `feature.customer_portal` off: the portal router answers 404 and the portal host serves a
      // disabled notice (features.md). A flag cannot unbind a hostname, so the host stays up.
      // A lookup failure is "unknown": still closed, but answered 503 "temporarily
      // unavailable" rather than the disabled 404 (P4R2-L1). Document GETs fall through to the
      // portal app (static assets and client routes only), which shows the feature-off state.
      const portalState = await featureStateSomewhere(
        "feature.customer_portal",
      );
      if (portalState !== "on") {
        if (
          isApiRequestPath(c.req.path) ||
          (c.req.method !== "GET" && c.req.method !== "HEAD")
        )
          return portalFeatureOffResponse(c.req.path, portalState);
        c.set("portalFeatureState", portalState);
        return securityHeaders(c, next);
      }
      const portalAllowed =
        (c.req.method === "POST" && c.req.path === "/api/public/csp-report") ||
        (c.req.method === "GET" && c.req.path === "/api/public/terminology") ||
        isCustomerAuthEndpoint(c.req.method, c.req.path) ||
        matchesPortalPolicyRoute(c.req.method, c.req.path) ||
        isPortalNotificationRequest ||
        isPortalNotificationSocket ||
        isPortalInvitationAuthRequest ||
        PORTAL_CANONICAL_PREFERENCE_ENDPOINTS.has(
          `${c.req.method} ${c.req.path}`,
        ) ||
        (c.req.method === "POST" &&
          c.req.path ===
            "/api/public/portal/notification-preference-handoffs") ||
        (c.req.method === "GET" &&
          (c.req.path === "/api/portal/csrf-token" ||
            c.req.path ===
              "/api/portal/notification-preferences/email-link-handoff")) ||
        isPortalSubmissionStorageRequest(
          c.req.method,
          c.req.path,
          c.req.query("key"),
        );
      if (isApiRequestPath(c.req.path) && !portalAllowed) return denyByHost(c);
      if (c.req.method !== "GET" && c.req.method !== "HEAD")
        if (!isApiRequestPath(c.req.path) || !portalAllowed)
          return denyByHost(c);
    }
    return securityHeaders(c, next);
  };
  declareCatchAllMiddleware(hostRoutingGuard);
  app.use("*", hostRoutingGuard);
  const corsOriginSource = [
    process.env.CORS_ORIGINS,
    process.env.TASKDESK_AGENT_URL,
  ].find((value) => value?.trim());
  const corsOrigins = corsOriginSource
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Fail CLOSED. kaneo used `NODE_ENV !== "production"`, and "not production"
  // includes "unset" — the normal case for a self-hosted deployment, which is
  // exactly what TaskDesk ships. That reflected ANY origin back with
  // `credentials: true`, letting any website read a logged-in victim's
  // authenticated responses. Reflection is now an explicit development opt-in.
  // Issue #6.
  const reflectUnconfiguredOrigins = process.env.NODE_ENV === "development";

  if (!corsOrigins && !reflectUnconfiguredOrigins) {
    console.warn(
      "[cors] Neither CORS_ORIGINS nor TASKDESK_AGENT_URL is set, so cross-origin requests are refused. Same-origin deployments (the bundled image) are unaffected; set TASKDESK_AGENT_URL if the web app is served from another origin.",
    );
  }

  const corsMiddleware = cors({
    credentials: true,
    origin: (origin) => {
      // Reflecting an arbitrary origin alongside credentials lets any site
      // read authenticated responses, so it stays a development convenience.
      if (!corsOrigins) {
        return reflectUnconfiguredOrigins ? origin || "*" : null;
      }

      if (!origin) {
        return null;
      }

      return corsOrigins.includes(origin) ? origin : null;
    },
  });
  // Declared to shadow-middleware.ts's classification guard (Opus delta F5) as reviewed
  // catch-all infrastructure -- see that module's own doc comment for why identity, not
  // this registration's `"ALL /*"` key, is what tells it apart from an unclassified route
  // that happened to share the key.
  declareCatchAllMiddleware(corsMiddleware);
  app.use("*", corsMiddleware);

  // Issue #704: every `/api` request body is capped -- 64 KiB for `/api/auth/*`, 20 MiB for
  // `POST /api/import-sources`, 10 MiB otherwise, the two raw upload streams exempt
  // (middleware/body-limits.ts). An oversize declared length is refused at once; a chunked body
  // is counted lazily as a route (Better Auth included) reads it, so a request the auth guard
  // refuses never has its body read at all. Registered after
  // the host guard (a denied host never gets this far, and the 413 carries security headers) and
  // after CORS (a cross-origin client can read the 413). Its own `ALL /*` registration, declared
  // like the others, so route coverage counts it as the reviewed middleware it is.
  declareCatchAllMiddleware(apiBodyLimitMiddleware);
  app.use("*", apiBodyLimitMiddleware);

  // Large boards return multi-MB JSON (board/task list responses embed
  // labels and external links per task); gzip cuts that by 85-95% since
  // JSON with repeated keys compresses extremely well.
  const compressMiddleware = compress();
  declareCatchAllMiddleware(compressMiddleware);
  app.use(compressMiddleware);

  // SCIM lives at the protocol's documented agent-origin path, outside `/api` and
  // therefore outside the session/API-key guard. The host-routing guard above admits
  // this path only on the agent origin; scimProtocol authenticates its dedicated bearer.
  const scimProtocolApi = app.route("/scim/v2", scimProtocol);

  const api = installStrictPolicyRegistration(new OpenAPIHono<ApiVariables>());
  const publicCspReportApi = api.route("/public/csp-report", cspReportApi);

  api.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  // Liveness: the process is up, touches no dependency. A Postgres blip must never
  // restart a healthy container — see docs/05-operations/deployment.md § Health and
  // readiness, and charts/taskdesk/values.yaml's comment on the same separation.
  api.get("/public/health/live", (c) => {
    return c.json({ status: "ok" });
  });

  // Readiness: database reachable. Migrations are a separate, earlier concern —
  // runStartupTasks() runs them and blocks serve() from ever accepting a connection
  // until they succeed, so by the time this handler can run at all, migrations have
  // already applied; a second check here would only re-assert what booting already
  // guaranteed.
  api.get("/public/health/ready", async (c) => {
    try {
      await getDatabase().execute(sql`SELECT 1`);
      return c.json({ status: "ok" });
    } catch {
      logDatabaseFailure();
      return c.json({ status: "error" }, 503);
    }
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getInstanceStatus",
      path: "/instance/status",
      tags: ["Instance"],
      summary: "Get instance status",
      description:
        "Public liveness probe for the auth surface. Deliberately a constant shape (#18): it never reveals whether the instance has been claimed, so an unauthenticated caller cannot scan for an unclaimed instance to race for admin. First-run setup is reached through the one-time setup URL and token printed to the container log, not discovered from here.",
      security: [],
      responses: {
        200: jsonResponse(
          "Instance status",
          z.object({ status: z.literal("ok") }).openapi("InstanceStatus"),
        ),
      },
    }),
    async (c) => c.json(await getInstanceStatus(), 200),
  );

  const invitationPublicApi = api.get("/invitation/public/:id", async (c) => {
    await requireAnonymousInvitationRateLimit(c);
    const { id } = c.req.param();
    // #281 sweep: this id reaches a raw `eq(invitationTable.id, ...)` query inside
    // `getInvitationDetails`, unvalidated -- a NUL byte would otherwise 500 instead
    // of a clean 400.
    rejectNulByte(id, "Invitation id");
    const result = await getInvitationDetails(id);
    return c.json(result);
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getSession",
      path: "/auth/get-session",
      tags: ["Authentication"],
      summary: "Get session",
      description:
        "Get the current authenticated session, or null when the caller is not signed in. Served by Better Auth.",
      security: [],
      responses: {
        200: {
          description: "Current session details, or null when unauthenticated",
        },
      },
    }),
    async (c) => handleAuthRequest(c),
  );

  api.openapi(
    createRoute({
      method: "put",
      operationId: "uploadFilesystemStorageObject",
      path: "/storage/filesystem-upload",
      tags: ["Assets"],
      summary: "Upload bytes to the filesystem storage driver",
      description:
        "The local equivalent of a presigned S3 PUT: accepts raw bytes for a short-lived, " +
        "key-scoped upload token minted by createTaskImageUploadUrl when " +
        "TASKDESK_STORAGE_DRIVER is filesystem (the default). Not authenticated by a browser " +
        "session — the signed token in the query string is the credential, the same way " +
        "possession of a presigned S3 URL is. 404s when the s3 driver is active, since that " +
        "driver never issues a URL pointing here.",
      security: [],
      request: {
        query: z.object({
          key: z.string().min(1),
          expires: z
            .string()
            .regex(/^\d+$/, "expires must be a unix timestamp"),
          token: z.string().min(1),
        }),
        body: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
      },
      responses: {
        204: { description: "Stored" },
        400: errorResponse(
          "Invalid key, expired or invalid token, or the upload exceeds the configured limit",
        ),
        404: errorResponse("The filesystem storage driver is not active"),
      },
    }),
    async (c) => {
      if (getStorageDriver() !== "filesystem") {
        throw new HTTPException(404, {
          message: "The filesystem storage driver is not active.",
        });
      }

      const { key, expires, token } = c.req.valid("query");

      try {
        await writeUploadedObject({
          key,
          expires,
          token,
          body: c.req.raw.body,
        });
      } catch (error) {
        // StoragePathError's message is deliberately safe to return as-is (traversal
        // refused, token invalid/expired, upload too large, ...) — it never contains a
        // filesystem path. Anything else here is an unexpected raw fs error (e.g. EEXIST,
        // ENOTDIR, ENOSPC) that embeds the server's own absolute storage-root path, which a
        // caller holding nothing but a valid upload token has no business seeing.
        //
        // The generic case is logged here, server-side only, before the safe message
        // reaches the client — found by the independent Opus delta review (finding A): the
        // prior version of this fix discarded the raw error entirely once it stopped
        // forwarding it to the client, so an ENOSPC/EACCES/EDQUOT on the storage volume
        // would have surfaced to nobody. Detailed to the log, generic to the client.
        if (!(error instanceof StoragePathError)) {
          logHttpRequestFailure();
        }
        throw new HTTPException(400, {
          message:
            error instanceof StoragePathError
              ? error.message
              : "Upload failed.",
        });
      }

      return c.body(null, 204);
    },
  );

  // Issue #28 (attachments): the generic, arbitrary-key sibling of the task-image
  // upload route above -- see `storage/filesystem.ts`'s own section comment for why
  // this is a separate route rather than a reused one (the size ceiling travels with
  // this route's own token, not a shared fixed default).
  api.openapi(
    createRoute({
      method: "put",
      operationId: "uploadFilesystemAttachmentObject",
      path: "/storage/filesystem-attachment-upload",
      tags: ["Assets"],
      summary: "Upload attachment bytes to the filesystem storage driver",
      description:
        "The local equivalent of a presigned S3 PUT for an attachment, minted by " +
        "POST /api/work-items/{key}/attachments/presign when TASKDESK_STORAGE_DRIVER " +
        "is filesystem (the default). Not authenticated by a browser session -- the " +
        "signed token in the query string, which also binds the exact size ceiling " +
        "that was validated at presign time, is the credential.",
      security: [],
      request: {
        query: z.object({
          key: z.string().min(1),
          maxBytes: z.string().regex(/^\d+$/, "maxBytes must be an integer"),
          expires: z
            .string()
            .regex(/^\d+$/, "expires must be a unix timestamp"),
          token: z.string().min(1),
        }),
        body: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
      },
      responses: {
        204: { description: "Stored" },
        400: errorResponse(
          "Invalid key, expired or invalid token, or the upload exceeds the signed limit",
        ),
        404: errorResponse("The filesystem storage driver is not active"),
      },
    }),
    async (c) => {
      if (getStorageDriver() !== "filesystem") {
        throw new HTTPException(404, {
          message: "The filesystem storage driver is not active.",
        });
      }

      const { key, maxBytes, expires, token } = c.req.valid("query");

      try {
        await writeAttachmentUploadedObject({
          key,
          maxBytes,
          expires,
          token,
          body: c.req.raw.body,
        });
      } catch (error) {
        // Same safe-message/log-detail split as the task-image upload route above.
        if (!(error instanceof StoragePathError)) {
          logHttpRequestFailure();
        }
        throw new HTTPException(400, {
          message:
            error instanceof StoragePathError
              ? error.message
              : "Upload failed.",
        });
      }

      return c.body(null, 204);
    },
  );

  // Issue #28 (attachments), AT-5: the local equivalent of a presigned S3 GET. Not
  // authenticated by a browser session -- the signed, short-lived, key-scoped token in
  // the query string is the credential, exactly like the upload route above; the real
  // policy check already ran in `GET /api/attachments/{id}`, which minted this URL.
  api.openapi(
    createRoute({
      method: "get",
      operationId: "downloadFilesystemAttachmentObject",
      path: "/storage/filesystem-download",
      tags: ["Assets"],
      summary: "Download attachment bytes from the filesystem storage driver",
      description:
        "The local equivalent of a presigned S3 GET, minted by GET " +
        "/api/attachments/{id} when TASKDESK_STORAGE_DRIVER is filesystem.",
      security: [],
      request: {
        query: z.object({
          key: z.string().min(1),
          expires: z
            .string()
            .regex(/^\d+$/, "expires must be a unix timestamp"),
          token: z.string().min(1),
          filename: z.string().min(1),
        }),
      },
      responses: {
        200: {
          description: "The attachment binary stream",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        400: errorResponse("Invalid key, or expired or invalid token"),
        404: errorResponse(
          "The filesystem storage driver is not active, or the object is gone",
        ),
      },
    }),
    async (c) => {
      if (getStorageDriver() !== "filesystem") {
        throw new HTTPException(404, {
          message: "The filesystem storage driver is not active.",
        });
      }

      const { key, expires, token, filename } = c.req.valid("query");

      try {
        // RFC 5987 `filename*` keeps non-Latin names (Myanmar script, CJK) out of the
        // ByteString-only header value. The header is built before the file is opened, and
        // the body is cancelled if the response still cannot be built, so a failure never
        // leaks a read stream's file handle.
        const contentDisposition = buildContentDisposition(filename, false);
        const object = await readAttachmentDownloadObject({
          key,
          expires,
          token,
        });
        const body = object.body as ReadableStream<Uint8Array> | null;
        try {
          return new Response(body, {
            headers: {
              "Cache-Control": "private, max-age=0, no-store",
              "Content-Type": object.contentType || "application/octet-stream",
              "Content-Disposition": contentDisposition,
            },
          });
        } catch (responseError) {
          await body?.cancel().catch(() => {});
          throw responseError;
        }
      } catch (error) {
        if (!(error instanceof StoragePathError)) {
          logHttpRequestFailure();
        }
        throw new HTTPException(error instanceof StoragePathError ? 400 : 404, {
          message:
            error instanceof StoragePathError
              ? error.message
              : "Attachment not found.",
        });
      }
    },
  );

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getUserAvatar",
      path: "/user/avatar/{id}",
      tags: ["User"],
      summary: "Download avatar",
      description:
        "Download a user avatar by its avatar ID. Public, immutable, and cache-friendly: the id changes whenever the avatar is replaced.",
      security: [],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: "The avatar image",
          content: {
            "image/*": { schema: { type: "string", format: "binary" } },
          },
        },
        304: { description: "Not modified" },
        404: { description: "Avatar not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const avatar = await getAvatar(id);

      if (!avatar) {
        throw new HTTPException(404, { message: "Avatar not found" });
      }

      const etag = `"${avatar.id}"`;
      if (c.req.header("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      return new Response(new Uint8Array(avatar.data) as BodyInit, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": avatar.size.toString(),
          "Content-Type": avatar.mimeType,
          "X-Content-Type-Options": "nosniff",
          ETag: etag,
          "Last-Modified": avatar.updatedAt.toUTCString(),
        },
      });
    },
  );

  const configApi = api.route("/config", config);

  api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "API key or session token (Bearer)",
  });

  api.openAPIRegistry.registerComponent("securitySchemes", "scimBearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Per-connection SCIM bearer token",
  });

  api.get("/openapi", (c) => {
    const document = api.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "TaskDesk API",
        version: "1.0.0",
        description:
          "TaskDesk Project Management API - Manage projects, tasks, labels, and more",
      },
      servers: [
        {
          // Runtime docs are consumed by self-hosted clients that may provide
          // bearer tokens. A relative URL keeps their credentials on the same
          // origin; the public contract exporter sets KANEO_API_URL explicitly.
          url: process.env.KANEO_API_URL
            ? normalizeApiServerUrl(process.env.KANEO_API_URL)
            : "/api",
          description: "TaskDesk API Server",
        },
      ],
      security: [{ bearerAuth: [] }],
    });

    const scimDocument = scimProtocol.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "TaskDesk SCIM API", version: "1.0.0" },
    });
    for (const [path, pathItem] of Object.entries(scimDocument.paths ?? {})) {
      if (!pathItem) continue;
      const scimPathItem: Record<string, unknown> = { ...pathItem };
      for (const method of [
        "get",
        "post",
        "put",
        "patch",
        "delete",
        "options",
        "head",
        "trace",
      ] as const) {
        const operation = scimPathItem[method];
        if (operation && typeof operation === "object")
          scimPathItem[method] = {
            ...(operation as Record<string, unknown>),
            security: [{ scimBearerAuth: [] }],
          };
      }
      document.paths ??= {};
      document.paths[`/scim/v2${path}`] = {
        // SCIM is mounted at the agent origin root, while the rest of the API
        // inherits the `/api` server above. A path-level relative root keeps
        // SCIM clients on the same origin without incorrectly prefixing `/api`.
        servers: [{ url: "/", description: "TaskDesk SCIM API Server" }],
        ...scimPathItem,
      } as NonNullable<typeof document.paths>[string];
    }

    // Every authenticated route sits behind the same app-wide
    // authenticateApiRequest middleware, so the shared 401 is injected here
    // rather than repeated on all ~120 route definitions. Routes that opt out
    // of auth declare `security: []` and are skipped.
    const httpMethods = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "options",
      "head",
      "trace",
    ];
    const paths = (document.paths ?? {}) as Record<
      string,
      Record<
        string,
        { responses?: Record<string, unknown>; security?: unknown[] }
      >
    >;
    for (const operations of Object.values(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!httpMethods.includes(method) || !operation.responses) continue;
        if (
          Array.isArray(operation.security) &&
          operation.security.length === 0
        ) {
          continue;
        }
        operation.responses["401"] ??= {
          description: "Missing or invalid credentials",
        };
      }
    }

    return c.json(document);
  });

  // Better Auth serves GET /auth/device as JSON. Browsers that open the API URL
  // directly expect a page, so redirect full document navigations to the web app.
  const authDeviceQuerySchema = z.object({
    user_code: z.string().optional().openapi({
      description: "The device authorization user code.",
    }),
    ui: z.enum(["1"]).optional().openapi({
      description:
        "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers.",
    }),
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getDeviceAuthorizationPage",
      path: "/auth/device",
      tags: ["Authentication"],
      summary: "Device authorization page",
      description:
        "Better Auth serves this as JSON. A top-level browser navigation is redirected to the web app's device screen instead, so opening the URL by hand shows a page rather than a JSON blob.",
      security: [],
      request: { query: authDeviceQuerySchema },
      responses: {
        302: {
          description: "Redirects the browser to the web app device screen",
        },
        200: { description: "Device authorization payload from Better Auth" },
      },
    }),
    async (c) => {
      const { user_code: userCode, ui } = c.req.valid("query");
      const secFetchDest = c.req.header("Sec-Fetch-Dest");
      const forceUiRedirect = ui === "1";
      // Top-level browser tab / address bar (not `fetch()` / XHR from the SPA).
      // Optional `ui=1` forces redirect when Sec-Fetch-* headers are missing (e.g. some clients).
      if (forceUiRedirect || secFetchDest === "document") {
        const clientUrl = (
          process.env.TASKDESK_AGENT_URL || "http://localhost:5173"
        ).replace(/\/$/, "");
        const deviceUrl = new URL(`${clientUrl}/device`);
        if (userCode) {
          deviceUrl.searchParams.set("user_code", userCode);
        }
        return c.redirect(deviceUrl.toString(), 302);
      }
      return authForRequest(c).handler(buildAuthRequest(c));
    },
  );

  api.on(["POST", "GET", "PUT", "PATCH", "DELETE"], "/auth/*", async (c) => {
    const mutation = await explicitAuthCredentialMutationForRequest(
      c.req.method,
      c.req.path,
      c.req.raw,
    );
    const authHeader = c.req.header("Authorization");
    const apiKeyHeader = c.req.header("x-api-key");
    const bearerToken = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (bearerToken && !apiKeyHeader) {
      const headers = new Headers(c.req.raw.headers);

      // Better Auth API key plugin validates from x-api-key by default.
      headers.set("x-api-key", bearerToken);

      return handleAuthRequest(c, headers, mutation);
    }

    return handleAuthRequest(c, undefined, mutation);
  });

  // Named (not inline in `.use()`) so its exact function reference can be declared to
  // shadow-middleware.ts (Opus delta F5) as reviewed catch-all infrastructure --
  // `assertRouteIsClassified` runs FROM INSIDE this very function, so `c.req.matchedRoutes`
  // always includes this guard's own entry, and it must be exempted from its own check the
  // same identity-based way CORS/compress/static-serving are.
  const publicAgentPreferenceHandoffApi = api.route(
    "/public/agent/notification-preference-handoffs",
    publicPreferenceHandoff("agent"),
  );
  const publicPortalPreferenceHandoffApi = api.route(
    "/public/portal/notification-preference-handoffs",
    publicPreferenceHandoff("customer"),
  );

  // CP-27/IP-35 anonymous portal-host-only discovery and fixed OIDC initiation.
  // Keep both routes above the app-wide session guard; the host guard and explicit
  // public policy entries restrict the exposed methods and portal origin.
  api.route("/", createHomeRealmApi());

  const portalAuthMethodsApi = api.route("/", portalAuthMethods);
  const customerInvitationPublicContinuationApi = api.route(
    "/",
    publicContinuation,
  );

  const publicTerminologyApi = api.route(
    "/public/terminology",
    publicTerminology,
  );

  const deleteIdempotency = idempotencyKeyMiddleware({
    store: createPostgresIdempotencyStore(),
  });
  const authGuard = async (c: Context<ApiVariables>, next: Next) => {
    // No prefix exemptions. kaneo exempted /api/mcp, /api/.well-known/ and
    // /api/billing/webhook; all three surfaces are removed in issue #6, so
    // every route mounted below this guard is authenticated without exception.
    // Adding one back is a route-policy decision that belongs to #7, not a
    // string appended here.
    // kaneo wrapped this in Sentry.withIsolationScope(...). With Sentry gone the
    // wrapper has no purpose, so the body runs directly — it must NOT become an
    // uninvoked arrow function, or authenticateApiRequest never runs and every
    // request through this guard succeeds unauthenticated.
    try {
      if (c.req.path === "/api/ws" || c.req.path.startsWith("/api/ws/")) {
        const hostResult = checkWebSocketOrigin({
          host: c.req.header("Host") ?? null,
          origin: null,
          sessionPortal: null,
          hasSession: false,
        });
        if (!hostResult.allowed)
          throw new HTTPException(403, { message: "Forbidden" });
      }
      await authenticateApiRequest(c);
      await enforceLocalFactorEnrollment(c);
      const csrfResponse = await csrfProtectionMiddleware()(c, async () => {});
      if (csrfResponse instanceof Response) return csrfResponse;
      // P4R2-M2: the customer's own organisation must have the portal on, not just "somewhere".
      if (portalForHost(c.req.header("host")) === "customer") {
        const portalOff = await enforceCustomerPortalFeature(c);
        if (portalOff) return portalOff;
      }
      // Issue #8: refuses outright (never silently serves) a route below this guard that
      // has no entry at all in the declarative policy registry -- see
      // `route-classification-guard.ts`'s own doc comment for exactly what this does and
      // does not check (presence only, never an ALLOW/DENY verdict).
      assertRouteIsClassified(c);
      // GM-9: an impersonation session is refused the restricted classes before any route runs.
      await enforceImpersonationRestrictions(c);
      const windowId = c.req.header("X-TaskDesk-Window-Id");
      const userId = c.get("userId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      // Issue #8, Slice 2: `runNextWithPolicyShadow` wraps this SAME `next` in place of
      // calling it directly — it evaluates the finished response against the declarative
      // policy registry and logs any disagreement, off by default
      // (`TASKDESK_POLICY_SHADOW`), never blocking or changing the response. It is called
      // from inside this existing guard, not registered as a second `api.use("*", ...)`,
      // specifically so the registration count at this key never changes — see that
      // function's own doc comment (`apps/api/src/permissions/shadow-middleware.ts`) for
      // why a second registration is not safe here.
      // `Idempotency-Key` on every unsafe request (PA-4, api-design.md) also runs from inside this guard,
      // for the same registration-count reason: it scopes a key to the authenticated
      // caller and sits before every route's pending-action layer, so a keyed retry
      // replays the stored 202 instead of creating a second pending action.
      const impersonatorId = (
        c.get("session") as { impersonatedBy?: string | null } | null
      )?.impersonatedBy;
      const runRequest = () =>
        eventContext.run({ initiatorId }, () =>
          !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
            ? deleteIdempotency(c, () => runNextWithPolicyShadow(c, next))
            : runNextWithPolicyShadow(c, next),
        );
      // GM-8: every audit row written by an impersonated request names the impersonator.
      return await (impersonatorId
        ? runWithImpersonator(impersonatorId, runRequest)
        : runRequest());
    } catch (error) {
      // A body read past the app-wide limit (issue #704) is the client's 413, answered by
      // apiBodyLimitMiddleware; it is not an authentication failure.
      if (error instanceof BodyLimitError) throw error;
      if (!(error instanceof HTTPException)) {
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "error",
          result: "failed",
        });
        throw new HTTPException(500, { message: "Internal Server Error" });
      }
      throw error;
    }
  };
  declareCatchAllMiddleware(authGuard);
  api.use("*", authGuard);

  // Registered below the app-wide auth guard (issue #8, H2 fix, `docs/07-planning/
  // security-reviews/21-policy-registry.md`): `loadReachableAsset` requires a real
  // bearer/API-key/session credential (`resolveAssetBearerOrCookie` throws 401 on none)
  // and then checks workspace reach in the same query, so this route was never actually
  // public -- it just sat above the guard, where H2's `isWithinAuthGuardScope()` correctly
  // refuses a `capability` policy rather than let registration position launder an
  // unauthenticated route into a green coverage check. Moved here so the policy in
  // `apps/api/src/asset/policy.ts` describes what the runtime actually enforces.
  //
  // #317 S3 (following #338's own S3 finding): no `403` response remains. A foreign
  // asset used to reach a 403 that got remapped to 404; folding the reach check into
  // the lookup query (`loadReachableAsset`) means an out-of-reach or missing asset id
  // is now the same "no row" result, so 403 is unreachable and the OpenAPI contract no
  // longer advertises a distinction the route doesn't make.
  api.openapi(
    createRoute({
      method: "get",
      operationId: "getAsset",
      path: "/asset/{id}",
      tags: ["Assets"],
      summary: "Download asset",
      description:
        "Download an uploaded asset. Requires a real credential (session, personal API key, or MCP key), membership of the asset's workspace and reach to the asset's project; image types are served inline, everything else as an attachment.",
      // #720: workspace reach AND project reach, resolved by `loadReachableAsset`.
      middleware: [requireAssetProjectReach] as const,
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: "The requested asset binary stream",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        304: { description: "Not modified" },
        401: errorResponse("No credential at all"),
        404: errorResponse("Asset not found, or not reachable by this caller"),
      },
    }),
    async (c) => {
      // The middleware already loaded the asset: existence, workspace reach and project
      // reach are one query and one 404 (#317 S1/S4, #720), so a foreign or out-of-reach
      // asset and a missing one cost the same single round trip and answer identically.
      const asset = c.get("reachableAsset") as ReachableAsset;
      try {
        await assertCallerHasCapability(
          asset.workspaceId,
          c.get("userId"),
          "workspace:read",
          capabilityCredential(c.get("apiKey")),
        );
      } catch (error) {
        if (error instanceof HTTPException && error.status === 403) {
          setShadowLegacyAuthorization(c, "denied");
        }
        throw error;
      }
      setShadowLegacyAuthorization(c, "allowed");

      try {
        const object = await getPrivateObject(asset.objectKey);
        const storedContentType =
          (object.contentType || asset.mimeType)
            .toLowerCase()
            .split(";")[0]
            ?.trim() ?? "";
        const inline = SAFE_INLINE_ASSET_TYPES.has(storedContentType);

        return new Response(object.body as BodyInit, {
          headers: {
            // Every asset is private: TaskDesk has no public-project read path.
            "Cache-Control": "private, max-age=120",
            "Content-Disposition": buildContentDisposition(
              asset.filename,
              inline,
            ),
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": inline
              ? storedContentType
              : "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            ETag: object.etag || "",
            "Last-Modified": object.lastModified?.toUTCString() || "",
          },
        });
      } catch {
        logHttpRequestFailure();
        throw new HTTPException(404, { message: "Asset object not found" });
      }
    },
  );

  const oauthApi = api.route("/oauth", oauth);
  const capabilitiesApi = api.route("/capabilities", capabilities);
  const projectApi = api.route("/project", project);
  const projectOverviewApi = api.route("/project", projectOverview);
  const projectStatesApi = api.route("/projects", projectStates);
  const projectSettingsInheritanceApi = api.route(
    "/projects",
    projectSettingsInheritance,
  );
  const taskApi = api.route("/task", task);
  const taskV2Api = api.route("/v2/task", taskV2);
  const columnApi = api.route("/column", column);
  const activityApi = api.route("/activity", activity);
  const cannedResponseApi = api.route("/canned-responses", cannedResponse);
  const commentApi = api.route("/comment", comment);
  const timeEntryApi = api.route("/time-entry", timeEntry);
  // P5 time and cost: /time-entries, /time-activities, /rates and /projects/{projectId}/budget(s).
  const timeTrackingApi = api.route("/", timeTracking);
  const labelApi = api.route("/label", label);
  // Audit-read routes mount FLAT (paths carried in full) so they match audit-trail.md's
  // API table verbatim: /api/instance/audit and /api/workspaces/{workspaceId}/audit.
  const auditApi = api.route("/", audit);
  const notificationApi = api.route("/notification", notification);
  const notificationPreferencesApi = api.route(
    "/notification-preferences",
    notificationPreferences,
  );
  const pendingActionApi = api.route("/me", pendingAction);
  const userPreferenceApi = api.route("/me", userPreference);
  const searchApi = api.route("/search", search);
  const serviceCalendarApi = api.route("/service-calendars", serviceCalendar);
  const slaPolicyApi = api.route("/sla-policies", slaPolicy);
  const taskRelationApi = api.route("/task-relation", taskRelation);
  const externalLinkApi = api.route("/external-link", externalLink);
  const workflowRuleApi = api.route("/workflow-rule", workflowRule);
  const workflowApi = api.route("/workflows", workflow);
  const invitationApi = api.route("/invitation", invitation);
  const workspaceApi = api.route("/workspace", workspace);
  const workspaceProjectSettingsApi = api.route(
    "/workspace",
    workspaceProjectSettings,
  );
  // #23 -- mounted at the api root, not a feature prefix: the spec's own API table names
  // two different path shapes for this one resource (`/projects/{projectId}/work-items`,
  // `/work-items/{key}`), which `workItem`'s own routes already declare in full. See
  // `work-item/index.ts`'s file comment.
  const workItemApi = api.route("/", workItem);
  const workItemRelationApi = api.route("/", workItemRelation);
  // P5 service catalogue, changes, freezes and releases: mounted at the root like work items.
  api.route("/", serviceManagement);
  const portalReleaseApi = api.route("/portal", portalReleaseRouter);
  const workItemCommentVersionsApi = api.route("/", workItemCommentVersions);
  const approvalApi = api.route("/", approval);
  const combinedWorkItemApi = api.route("/", combinedWorkItemRouter);
  const organisationLifecycleApi = api.route(
    "/instance",
    organisationLifecycle,
  );
  const instanceTerminologyApi = api.route(
    "/instance/terminology",
    instanceTerminology,
  );
  const workspaceTerminologyApi = api.route(
    "/workspaces",
    workspaceTerminology,
  );
  const portalTerminologyApi = api.route(
    "/portal/terminology",
    portalTerminology,
  );
  const portalNotificationApi = api.route(
    "/portal/notification",
    portalNotificationRouter,
  );
  api.get("/ws/portal/notification", createPortalNotificationWebSocket());
  const intakeApi = api.route("/", intake);
  const intakeQueueReadApi = api.route("/intake", intakeQueueReadRouter);
  const intakeQueueRunApi = api.route("/intake", intakeQueueRunRouter);
  const intakeQueueWriteApi = api.route("/intake", intakeQueueWriteRouter);
  const requestTypeGroupOrderApi = api.route("/", requestTypeGroupOrderRouter);
  const attachmentApi = api.route("/", attachment);
  const userApi = api.route("/user", user);
  const viewApi = api.route("/views", view);
  const factorStatusApi = api.route("/me", factorStatus);
  const csrfTokenApi = api.route("/me", csrfToken);
  const portalCsrfTokenApi = api.route("/portal", portalCsrfToken);
  const agentPreferenceHandoffApi = api.route(
    "/notification-preferences",
    authenticatedPreferenceHandoff("agent"),
  );
  const portalPreferenceHandoffApi = api.route(
    "/portal/notification-preferences",
    authenticatedPreferenceHandoff("customer"),
  );
  api.route(
    "/portal/notification-preferences/canonical",
    portalCanonicalPreferences,
  );
  const stepUpApi = api.route("/me", stepUp);
  const notificationProviderApi = api.route("/instance", notificationProvider);
  const observabilityApi = api.route("/instance", observability);
  const metricsTokenRotationApi = api.route("/instance", metricsTokenRotation);
  const localFactorPolicyApi = api.route("/instance", localFactorPolicy);
  const authLocalMethodsApi = api.route("/", authLocalMethods);
  const resetMfaApi = api.route("/instance", resetMfa);
  const usersApi = api.route("/instance", users);
  const hardPurgeApi = api.route("/instance", hardPurge);
  const impersonationApi = api.route("/instance", impersonation);
  const rotateSecretsApi = api.route("/instance", rotateSecrets);
  const identityConnectionAdminApi = api.route(
    "/instance",
    identityConnectionAdmin,
  );
  const identityConnectionDeletionApi = api.route(
    "/instance",
    identityConnectionDeletion,
  );
  const oidcGroupMappingAdminApi = api.route(
    "/instance",
    oidcGroupMappingAdminRouter,
  );
  const scimAdminApi = api.route("/instance", scimAdmin);
  const instanceDeliveriesApi = api.route("/instance", instanceDeliveries);
  const instanceDeliveryRequeueApi = api.route(
    "/instance",
    instanceDeliveryRequeue,
  );
  const instanceJobsApi = api.route("/instance", instanceJobs);
  const instanceMcpUsageApi = api.route("/instance", instanceMcpUsage);
  const importsApi = api.route(
    "/",
    createImportRouter({ requestImportChunkApproval }),
  );
  const instanceStorageApi = api.route("/instance", instanceStorage);
  const mcpTelemetryApi = api.route("/", mcpTelemetry);
  const meIdentityApi = api.route("/me", meIdentity);
  const accountLinkApi = api.route("/me", accountLinkRouter);
  const instancePluginsApi = api.route("/instance", instancePlugins);
  const instanceHealthApi = api.route("/instance", instanceHealth);
  const instanceSettingsApi = api.route("/instance", instanceSettings);
  const organisationCustomerVisibilityApi = api.route(
    "/instance",
    organisationCustomerVisibility,
  );
  const organisationCatalogueApi = api.route(
    "/instance",
    organisationCatalogue,
  );
  // P4 integration. Feature-flag, automation and api-key routers declare full paths
  // (`/instance/features`, `/workspaces/{id}/automations`, `/me/api-keys`, ...), so they
  // mount at the api root like `workItem`.
  const featureFlagApi = api.route("/", featureFlag);
  const automationApi = api.route("/", automation);
  const agileApi = api.route("/", agile);
  const pagesApi = api.route("/", pages);
  const customerInvitationApi = api.route("/", customerInvitation);
  const customerInvitationAcceptContinuationApi = api.route(
    "/",
    acceptContinuation,
  );
  const apiKeyApi = api.route("/", apiKey);
  const webhookApi = api.route("/webhooks", webhook);
  const webhookSecurityPostureApi = api.route("/", webhookSecurityPosture);
  const webhookRotateAllApi = api.route("/", webhookRotateAll);
  const customFieldApi = api.route("/custom-fields", customField);
  const customFieldSectionApi = api.route(
    "/custom-field-sections",
    customFieldSections,
  );
  const teamApi = api.route("/teams", team);
  const kbApi = api.route("/", kb);
  // P5 reports and dashboards: /reports and /dashboards, staff only (customers receive 403).
  const reportApi = api.route("/", report);

  // User-scoped WebSocket endpoint; MUST be registered before /ws/:projectId
  // so the literal path "user" isn't consumed by the param route.
  api.get(
    "/ws",
    upgradeWebSocket(async (c) => {
      const host = c.req.header("Host") ?? null;
      const hostResult = checkWebSocketOrigin({
        host,
        origin: null,
        sessionPortal: null,
        hasSession: false,
      });
      if (!hostResult.allowed)
        throw new HTTPException(403, { message: "Forbidden" });
      try {
        await authenticateApiRequest(c);
        await enforceLocalFactorEnrollment(c);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "error",
          result: "failed",
        });
        throw new HTTPException(500, { message: "Internal Server Error" });
      }
      const originResult = checkWebSocketOrigin({
        host,
        origin: c.req.header("Origin") ?? null,
        sessionPortal: (
          c.get("session") as (Session & { portal?: unknown }) | null
        )?.portal,
        hasSession: c.get("session") !== null,
      });
      if (!originResult.allowed)
        throw new HTTPException(originResult.status, { message: "Forbidden" });

      const readCredential = () => {
        const apiKey = c.get("apiKey") as ApiKey | undefined;
        const session = c.get("session") as
          | (Session & { portal?: "agent" | "customer" })
          | null;
        return {
          userId: c.get("userId") as string,
          apiKeyId: apiKey?.id,
          apiKeyEnabled: apiKey?.enabled,
          apiKeyOwnerUserId: apiKey?.userId,
          apiKeyPermissions: apiKey?.permissions,
          impersonated: Boolean(
            (session as { impersonatedBy?: string | null } | null)
              ?.impersonatedBy,
          ),
          portal: session?.portal ?? null,
        };
      };
      let nativeConnection: ReturnType<typeof addNativeConnection> = null;
      return {
        onOpen(_event, ws) {
          nativeConnection = addNativeConnection(
            ws,
            readCredential(),
            async () => {
              try {
                await authenticateApiRequest(c);
                await enforceLocalFactorEnrollment(c);
                const refreshed = readCredential();
                if (!refreshed.userId) return null;
                return refreshed;
              } catch {
                return null;
              }
            },
          );
        },
        onMessage(event, ws) {
          const raw =
            typeof event.data === "string"
              ? event.data
              : Buffer.isBuffer(event.data)
                ? event.data.toString()
                : null;
          if (!raw) {
            ws.close(1007, "invalid frame");
            return;
          }
          if (nativeConnection) void handleNativeFrame(nativeConnection, raw);
        },
        onClose() {
          removeNativeConnection(nativeConnection);
          nativeConnection = null;
        },
      };
    }),
  );

  api.get(
    "/ws/user",
    upgradeWebSocket(async (c) => {
      try {
        await authenticateApiRequest(c);
        await enforceLocalFactorEnrollment(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "error",
          result: "failed",
        });
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const originResult = checkWebSocketOrigin({
        host: c.req.header("Host") ?? null,
        origin: c.req.header("Origin") ?? null,
        sessionPortal: (
          c.get("session") as (Session & { portal?: unknown }) | null
        )?.portal,
        hasSession: c.get("session") !== null,
      });
      if (!originResult.allowed) {
        throw new HTTPException(originResult.status, { message: "Forbidden" });
      }

      const userId = c.get("userId");
      let conn: ReturnType<typeof addUserConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (userId) {
            conn = addUserConnection(userId, ws, async () => {
              try {
                await authenticateApiRequest(c);
                await enforceLocalFactorEnrollment(c);
                const currentUser = c.get("user") as
                  | (User & { banned?: boolean | null })
                  | null;
                if (currentUser?.banned === true) return false;
                const session = c.get("session") as
                  | (Session & { portal?: unknown })
                  | null;
                return (
                  c.get("userId") === userId &&
                  (!session || session.portal === "agent")
                );
              } catch {
                return false;
              }
            });
          }
        },
        onMessage(evt) {
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // keepalive, no-op
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && userId) {
            removeUserConnection(userId, conn);
          }
        },
      };
    }),
  );

  api.get(
    "/ws/:projectId",
    // #745: origin policy and PROJECT reach are decided by this middleware, before the upgrade;
    // its reach mark is what `project-reach-guard.test.ts` requires of the route.
    requireLegacySocketProjectReach,
    upgradeWebSocket(async (c) => {
      const projectId = c.req.param("projectId");

      try {
        await authenticateApiRequest(c);
        await enforceLocalFactorEnrollment(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logTaskDesk({
          module: "auth",
          message: "auth.failure",
          level: "error",
          result: "failed",
        });
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");

      const windowId = c.req.query("windowId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      let conn: ReturnType<typeof addConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (projectId) {
            const opened = addConnectionWithinLimit(
              projectId,
              ws,
              userId,
              initiatorId,
              async () => {
                try {
                  await authenticateApiRequest(c);
                  await enforceLocalFactorEnrollment(c);
                  const currentUser = c.get("user") as
                    | (User & { banned?: boolean | null })
                    | null;
                  if (currentUser?.banned === true) return false;
                  const session = c.get("session") as
                    | (Session & { portal?: unknown })
                    | null;
                  if (
                    c.get("userId") !== userId ||
                    (session && session.portal !== "agent")
                  )
                    return false;
                  const project = await callerReachesLegacySocketProject(
                    c,
                    userId,
                    projectId,
                  );
                  return Boolean(project);
                } catch {
                  return false;
                }
              },
            );
            // #748: the same per-person cap the native socket enforces.
            if (!opened) {
              ws.close(1008, "connection limit");
              return;
            }
            conn = opened;
          }
        },
        onMessage(evt) {
          // Respond to client keepalive pings (sent every 30s to prevent
          // Cloudflare from closing idle connections at 100s timeout)
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // No-op: receiving the ping is enough to satisfy Cloudflare.
                // A pong response is optional but helps confirm liveness.
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && projectId) {
            removeConnection(projectId, conn);
          }
        },
      };
    }),
  );

  app.route("/api", api);
  options.registerAdditionalRoutes?.(app);
  registerStaticServing(app, staticRoots);

  return {
    app,
    api,
    activityApi,
    approvalApi,
    attachmentApi,
    auditApi,
    cannedResponseApi,
    capabilitiesApi,
    columnApi,
    commentApi,
    configApi,
    externalLinkApi,
    factorStatusApi,
    csrfTokenApi,
    portalCsrfTokenApi,
    publicAgentPreferenceHandoffApi,
    publicPortalPreferenceHandoffApi,
    agentPreferenceHandoffApi,
    portalPreferenceHandoffApi,
    stepUpApi,
    notificationProviderApi,
    observabilityApi,
    metricsTokenRotationApi,
    localFactorPolicyApi,
    authLocalMethodsApi,
    resetMfaApi,
    usersApi,
    hardPurgeApi,
    impersonationApi,
    rotateSecretsApi,
    identityConnectionAdminApi,
    identityConnectionDeletionApi,
    oidcGroupMappingAdminApi,
    scimAdminApi,
    instanceDeliveriesApi,
    instanceDeliveryRequeueApi,
    instanceJobsApi,
    instanceMcpUsageApi,
    importsApi,
    instanceStorageApi,
    mcpTelemetryApi,
    meIdentityApi,
    accountLinkApi,
    publicCspReportApi,
    instancePluginsApi,
    instanceHealthApi,
    instanceSettingsApi,
    organisationCustomerVisibilityApi,
    combinedWorkItemApi,
    organisationLifecycleApi,
    organisationCatalogueApi,
    featureFlagApi,
    automationApi,
    agileApi,
    pagesApi,
    customerInvitationApi,
    portalAuthMethodsApi,
    customerInvitationPublicContinuationApi,
    customerInvitationAcceptContinuationApi,
    apiKeyApi,
    webhookApi,
    webhookSecurityPostureApi,
    webhookRotateAllApi,
    customFieldApi,
    customFieldSectionApi,
    teamApi,
    kbApi,
    portalReleaseApi,
    reportApi,
    scimProtocolApi,
    invitationApi,
    invitationPublicApi,
    publicTerminologyApi,
    instanceTerminologyApi,
    workspaceTerminologyApi,
    portalTerminologyApi,
    portalNotificationApi,
    intakeApi,
    intakeQueueReadApi,
    intakeQueueRunApi,
    intakeQueueWriteApi,
    requestTypeGroupOrderApi,
    oauthApi,
    labelApi,
    notificationApi,
    notificationPreferencesApi,
    pendingActionApi,
    userPreferenceApi,
    projectApi,
    projectOverviewApi,
    projectStatesApi,
    projectSettingsInheritanceApi,
    searchApi,
    serviceCalendarApi,
    slaPolicyApi,
    taskApi,
    taskV2Api,
    taskRelationApi,
    timeEntryApi,
    timeTrackingApi,
    userApi,
    viewApi,
    workflowApi,
    workflowRuleApi,
    workItemApi,
    workItemRelationApi,
    workItemCommentVersionsApi,
    workspaceApi,
    workspaceProjectSettingsApi,
  };
}

/**
 * Issue #296, S1 (Opus 5.5 review of PR #308, BLOCKING): this used to be one function,
 * `runStartupTasks`, that did every DDL step AND every serving-process boot step inside
 * the one long-running API process — which meant that process had to be *started* with
 * `TASKDESK_MIGRATION_DATABASE_URL` in its environment, the owner/superuser credential.
 * `closeMigrationPool()` closed the pool, but the review reproduced live that the URL
 * itself stays in the process's own environment variables and in `/proc/self/environ`
 * for that process's whole life — any process-level compromise (RCE, a malicious
 * dependency, an arbitrary file read) could still connect as the owner and undo every
 * append-only/no-DDL control this whole issue exists to build.
 *
 * The fix, per the review's recommended option: two entry points, run as two genuinely
 * separate OS processes, so the owner credential is never in the serving process's
 * environment at all — not "closed", never present.
 *   - `runMigrationStep()` — everything that needs the owner/migration connection:
 *     the hand-written pre-migrate fixups, Drizzle's own `migrate()`, and
 *     `ensureApplicationRole`. Selected by `TASKDESK_ROLE=migrate` (see the
 *     `isMainModule` block below), following the same env-var-selects-behaviour
 *     pattern `TASKDESK_ROLE=web`/`jobs` already document
 *     (`docs/05-operations/container-image.md`) — not a new, parallel mechanism.
 *   - `runApiBootTasks()` — everything the serving process needs, using ONLY the
 *     application connection: `assertApplicationRoleIsNotPrivileged`, the policy
 *     registry log line (#302), the DML-only seed/backfill steps, plugin/scheduler/
 *     websocket init. It also asserts, first, that its own environment carries no
 *     migration credential at all (`assertNoMigrationUrlInApiProcess`) — a structural,
 *     fail-loud backstop in case compose/Helm/an operator's own overlay ever wires the
 *     owner URL to this process again.
 *
 * In compose and Helm, the migrate step is now a separate one-shot service/Job that
 * alone receives `TASKDESK_MIGRATION_DATABASE_URL`; the API (and jobs) service/
 * Deployment depends on it completing successfully and never receives that variable.
 */
export async function runMigrationStep(): Promise<void> {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // Every DDL step below runs on the migration/owner connection
  // (`TASKDESK_MIGRATION_DATABASE_URL`, falling back to `TASKDESK_DATABASE_URL` when
  // unset — see `resolveMigrationDatabaseConfig`'s own doc comment for what that
  // fallback means and who it is for), never on the application connection
  // `getDatabase()` serves requests with — and in the split design this process never
  // calls `getDatabase()` at all.
  const migrationDb = getMigrationDatabase();

  await prepareDatabaseStartup({
    resolveConfig: resolveMigrationDatabaseConfig,
    waitForDatabase: async () => {
      await waitForDatabase({
        query: async () => {
          await migrationDb.execute(sql`SELECT 1`);
        },
      });
    },
    runStartupMigrations: async () => {
      await migrateWorkspaceUserEmail(migrationDb);
      await migrateSessionColumn(migrationDb);

      console.log("🔄 Migrating database...");
      await migrateWithMembershipProvenanceCutover({
        database: migrationDb,
        pool: getMigrationDatabasePool(),
        migrationsFolder: `${currentDir}/../drizzle`,
      });
      console.log("✅ Database migrated successfully!");

      // After Drizzle migrations: apikey table must exist so we can align columns
      // with Better Auth (reference_id + nullable user_id).
      await migrateApiKeyReferenceId(migrationDb);
      await migrateNotificationPreferencesSchema(migrationDb);

      // Creates/repairs the non-superuser application role and its grants — must
      // run as the owner, after the schema it grants on exists, and before the
      // application process ever connects as it for the first time.
      await ensureApplicationRole(migrationDb);
    },
  });

  // This process's whole job is done: close the pool. (The migrate step is one-shot
  // and exits right after this returns, so the owner URL's exposure window is this
  // short-lived process's lifetime, not the API's — the actual point of the split.)
  await closeMigrationPool();
}

/** Bounded best-effort recovery; failures never masquerade as a completed scan. */
export async function runPositionRecoveryBootTask(): Promise<void> {
  try {
    const outcomes = await recoverDensePositionPartitions(10, {
      scanRows: 2000,
      maxPartitionRows: 1000,
    });
    const deferred = outcomes.filter(
      ({ outcome }) => !["healthy", "rebalanced"].includes(outcome.status),
    ).length;
    if (deferred) {
      logTaskDesk({
        module: "jobs",
        message: "jobs.failure",
        level: "warn",
        result: "degraded",
      });
      console.warn(
        `Position recovery deferred ${deferred} partition(s); bounded startup scan is incomplete`,
      );
    } else {
      console.log(
        `Position recovery: ${outcomes.length} partition(s) examined within startup bounds; this is not a full scan`,
      );
    }
  } catch {
    logTaskDesk({
      module: "jobs",
      message: "jobs.failure",
      level: "error",
      result: "degraded",
    });
    console.warn(
      "Position recovery failed; deferred work remains persisted for retry",
    );
  }
}

/**
 * The serving process's own boot sequence — application connection only. See
 * `runMigrationStep`'s doc comment above for why these are two separate functions,
 * run from two separate OS processes, rather than two calls in one.
 */
export async function runApiBootTasks(
  options: Pick<NodeServerShutdownOptions, "hostname" | "role"> = {},
): Promise<void> {
  const role = options.role ?? "all";
  // S1's structural backstop: fail loudly, before anything else, if this process's
  // own environment carries the owner/migration credential at all. A correctly
  // configured compose/Helm deployment never sets it here in the first place; this
  // is what catches a misconfiguration (a copy-pasted overlay, a hand-edited
  // Deployment) rather than silently running with it present but merely "unused".
  assertNoMigrationUrlInApiProcess();

  // First use of the application connection. `runMigrationStep` (a separate process
  // that has already exited by the time this runs) created/fixed the role this
  // process authenticates as, so this is also the right moment to assert the
  // invariant every append-only/no-DDL control on this connection depends on: it
  // must not be a superuser, and it must not own anything.
  await assertApplicationRoleIsNotPrivileged(getDatabase());

  console.log(`🔐 ${policyRegistry.entries.length} policies loaded`);

  await migrateColumns();
  if (roleOwnsHttp(role)) await startAuthConfigRuntime();
  await seedDefaultWorkspaceRoles();
  await seedCanonicalWorkspaceRoles();
  await seedInternalOrganisationAndStaffPersons();
  // Owner/admin explicit sees_all (decision log 2026-10-14): re-sync members whose person
  // or genuine-admin role row was created/healed by the two seeds above.
  await reconcileWorkspaceAdminReach();

  // #316: backfill the default work-item types, state templates and project states
  // that #309/#313 only seed on NEW workspace/project creation -- see that file's own
  // doc comment for the mechanism and why it is a boot step, not a migration.
  await backfillWorkspaceAndProjectDefaults();
  if (roleOwnsGeneralJobs(role)) await runPositionRecoveryBootTask();

  // #18: print a fresh setup token (and invalidate the previous one) on
  // every boot while the instance is unclaimed. A no-op once
  // instance_setting.setup_completed_at is set.
  if (roleOwnsHttp(role)) await ensureSetupToken();

  initializePlugins();
  if (roleOwnsHttp(role)) await purgeExpiredCustomerInvitationEnvelopes();
  initializeScheduler(role);
  // Jobs replicas publish outbox and control-plane messages through this adapter even though
  // they do not accept WebSocket upgrades or bind the API listener.
  await initializeWebSocketAdapter();
  if (roleOwnsHttp(role)) await startInboxRealtimeListener();
  await startObservabilityRuntime({
    ...(options.hostname ? { hostname: options.hostname } : {}),
    metricsListener: roleOwnsHttp(role),
  });
}

const DEFAULT_PORT = 5173;
const MAX_PORT = 65535;

/**
 * Resolves TASKDESK_PORT to a bindable port, falling back to DEFAULT_PORT for anything
 * outside the valid TCP range (1-65535) rather than passing it straight to
 * @hono/node-server's serve(), which throws a RangeError that becomes an unhandled
 * rejection and crashes the process instead of a graceful fallback.
 */
export function resolvePort(rawPort: string | undefined): {
  port: number;
  invalid: boolean;
} {
  const parsedPort = rawPort === undefined ? Number.NaN : Number(rawPort);
  const isValidPort =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= MAX_PORT;
  return {
    port: isValidPort ? parsedPort : DEFAULT_PORT,
    invalid: rawPort !== undefined && !isValidPort,
  };
}

type NodeServerShutdownOptions = {
  hostname?: string;
  role?: ServingRole;
  shutdownTimeoutMs?: number;
  shutdownAdapter?: () => Promise<void>;
  forceAdapter?: () => void;
};

type ShutdownResult = "graceful" | "forced";

export function createNodeServer(
  app: Hono<AppVariables>,
  port = 0,
  options: NodeServerShutdownOptions = {},
) {
  const websocketServer = new WebSocketServer({ noServer: true });
  const server = serve({
    fetch: app.fetch,
    port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    websocket: { server: websocketServer },
  });
  const httpServer = server as HttpServer;

  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
  const shutdownAdapter = options.shutdownAdapter ?? shutdownWebSocketAdapter;
  const forceAdapter = options.forceAdapter ?? forceShutdownWebSocketAdapter;
  let closePromise: Promise<ShutdownResult> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    stopAuthConfigRuntime();

    let resolveClose!: (result: ShutdownResult) => void;
    closePromise = new Promise<ShutdownResult>((resolve) => {
      resolveClose = resolve;
    });

    let httpClosed = false;
    let websocketClosed = false;
    let adapterClosed = false;
    let forced = false;
    let finished = false;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (timedOut = false) => {
      if (finished) return;
      if (!timedOut && (!httpClosed || !websocketClosed || !adapterClosed)) {
        return;
      }
      finished = true;
      clearTimeout(deadline);
      resolveClose(forced ? "forced" : "graceful");
    };
    const forceResources = () => {
      if (forced) return;
      forced = true;
      logHttpLifecycleFailure();
      try {
        httpServer.closeAllConnections();
      } catch {
        logHttpLifecycleFailure();
      }
      for (const client of websocketServer.clients) {
        try {
          client.terminate();
        } catch {
          logRealtimeFailure();
        }
      }
      try {
        forceAdapter();
      } catch {
        logRealtimeFailure();
      }
    };
    deadline = setTimeout(() => {
      forceResources();
      finish(true);
    }, shutdownTimeoutMs);

    // Closing the listener is first so no new request or upgrade can race Redis cleanup.
    try {
      server.close((error) => {
        if (error) {
          const errorCode = (error as NodeJS.ErrnoException).code;
          if (errorCode !== "ERR_SERVER_NOT_RUNNING" || server.listening) {
            logHttpLifecycleFailure();
            forceResources();
          }
        }
        httpClosed = true;
        finish();
      });
    } catch {
      if (server.listening) {
        logHttpLifecycleFailure();
        forceResources();
      }
      httpClosed = true;
      finish();
    }

    try {
      websocketServer.close((error) => {
        if (error) {
          logRealtimeFailure();
          forceResources();
        }
        websocketClosed = true;
        finish();
      });
    } catch {
      logRealtimeFailure();
      forceResources();
      websocketClosed = true;
      finish();
    }

    for (const client of websocketServer.clients) {
      try {
        client.close(1001, "Server shutting down");
      } catch {
        logRealtimeFailure();
        forceResources();
      }
    }

    void Promise.resolve()
      .then(() => shutdownAdapter())
      .then(
        () => {
          adapterClosed = true;
          finish();
        },
        () => {
          logRealtimeFailure();
          adapterClosed = true;
          forceResources();
          finish();
        },
      );

    return closePromise;
  };

  return { server, websocketServer, close };
}

export async function startServer(
  port = DEFAULT_PORT,
  options: Pick<NodeServerShutdownOptions, "hostname" | "role"> = {},
) {
  const role = options.role ?? "all";
  try {
    await runApiBootTasks(options);
  } catch {
    logHttpLifecycleFailure();
    process.exit(1);
  }

  let shuttingDown = false;

  if (!roleOwnsHttp(role)) {
    let stopLiveness: (() => Promise<void>) | undefined;
    try {
      stopLiveness = await startJobLivenessServer();
    } catch {
      shutdownScheduler();
      await stopObservabilityRuntime();
      customerInvitationDeliveryKeyring.dispose();
      await shutdownWebSocketAdapter().catch(() => logRealtimeFailure());
      logHttpLifecycleFailure();
      process.exit(1);
    }
    const gracefulJobsShutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      shutdownScheduler();
      await stopObservabilityRuntime();
      customerInvitationDeliveryKeyring.dispose();
      await shutdownWebSocketAdapter().catch(() => logRealtimeFailure());
      await stopLiveness?.().catch(() => logHttpLifecycleFailure());
      process.exit(0);
    };
    process.on("SIGTERM", () => void gracefulJobsShutdown());
    process.on("SIGINT", () => void gracefulJobsShutdown());
    console.log("⚙️ Jobs role is running without an HTTP listener");
    return;
  }

  const { close, server } = createNodeServer(app, port, options);
  server.on("listening", () => {
    const address = server.address();
    if (
      options.hostname &&
      (!address ||
        typeof address === "string" ||
        address.address !== options.hostname)
    ) {
      logHttpLifecycleFailure();
      void close().finally(() => process.exit(1));
      return;
    }
    console.log(
      `⚡ API is running at ${process.env.KANEO_API_URL || `http://localhost:${port}`}`,
    );
  });

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("🛑 Shutting down gracefully...");
    shutdownScheduler();
    await stopObservabilityRuntime();
    customerInvitationDeliveryKeyring.dispose();
    const result = await close();
    if (result === "graceful") {
      console.log("✅ API shutdown completed gracefully");
    } else {
      logHttpLifecycleFailure();
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  process.on("SIGINT", () => {
    void gracefulShutdown();
  });
}

const createdApp = createApp();
const {
  app,
  activityApi,
  approvalApi,
  attachmentApi,
  auditApi,
  cannedResponseApi,
  capabilitiesApi,
  columnApi,
  commentApi,
  configApi,
  externalLinkApi,
  factorStatusApi,
  csrfTokenApi,
  portalCsrfTokenApi,
  publicAgentPreferenceHandoffApi,
  publicPortalPreferenceHandoffApi,
  agentPreferenceHandoffApi,
  portalPreferenceHandoffApi,
  stepUpApi,
  notificationProviderApi,
  observabilityApi,
  metricsTokenRotationApi,
  localFactorPolicyApi,
  authLocalMethodsApi,
  resetMfaApi,
  usersApi,
  hardPurgeApi,
  impersonationApi,
  rotateSecretsApi,
  identityConnectionAdminApi,
  identityConnectionDeletionApi,
  oidcGroupMappingAdminApi,
  scimAdminApi,
  instanceDeliveriesApi,
  instanceDeliveryRequeueApi,
  instanceJobsApi,
  instanceMcpUsageApi,
  importsApi,
  instanceStorageApi,
  mcpTelemetryApi,
  meIdentityApi,
  accountLinkApi,
  publicCspReportApi,
  instancePluginsApi,
  instanceHealthApi,
  instanceSettingsApi,
  organisationCustomerVisibilityApi,
  combinedWorkItemApi,
  organisationLifecycleApi,
  organisationCatalogueApi,
  featureFlagApi,
  automationApi,
  agileApi,
  pagesApi,
  customerInvitationApi,
  portalAuthMethodsApi,
  customerInvitationPublicContinuationApi,
  customerInvitationAcceptContinuationApi,
  apiKeyApi,
  webhookApi,
  webhookSecurityPostureApi,
  webhookRotateAllApi,
  customFieldApi,
  customFieldSectionApi,
  teamApi,
  kbApi,
  portalReleaseApi,
  reportApi,
  scimProtocolApi,
  invitationApi,
  invitationPublicApi,
  publicTerminologyApi,
  instanceTerminologyApi,
  workspaceTerminologyApi,
  portalTerminologyApi,
  portalNotificationApi,
  intakeApi,
  intakeQueueReadApi,
  intakeQueueRunApi,
  intakeQueueWriteApi,
  requestTypeGroupOrderApi,
  oauthApi,
  labelApi,
  notificationApi,
  notificationPreferencesApi,
  pendingActionApi,
  userPreferenceApi,
  projectApi,
  projectOverviewApi,
  projectStatesApi,
  projectSettingsInheritanceApi,
  searchApi,
  serviceCalendarApi,
  slaPolicyApi,
  taskApi,
  taskV2Api,
  taskRelationApi,
  timeEntryApi,
  timeTrackingApi,
  userApi,
  viewApi,
  workflowApi,
  workflowRuleApi,
  workItemApi,
  workItemRelationApi,
  workItemCommentVersionsApi,
  workspaceApi,
  workspaceProjectSettingsApi,
} = createdApp;

const entrypoint = process.argv[1];
const isMainModule =
  entrypoint !== undefined &&
  entrypoint !== "" &&
  import.meta.url === pathToFileURL(entrypoint).href;

if (isMainModule) {
  // Issue #296, S1: `TASKDESK_ROLE=migrate` selects the one-shot migration entry
  // point instead of the serving one — same role switch documented in
  // `docs/technical/operations-and-distribution.md`, not a new mechanism. This process never calls
  // `startServer()`/`serve()`, so it never binds a port and never touches the
  // application connection.
  let role: ReturnType<typeof parseTaskDeskRole>;
  try {
    role = parseTaskDeskRole();
  } catch {
    logHttpLifecycleFailure();
    process.exit(1);
  }
  if (role === "migrate") {
    runMigrationStep()
      .then(() => {
        console.log("✅ Migration step complete.");
        process.exit(0);
      })
      .catch(() => {
        logDatabaseFailure();
        process.exit(1);
      });
  } else {
    const rawPort = process.env.TASKDESK_PORT;
    const { port, invalid } = resolvePort(rawPort);
    if (invalid) {
      console.warn(
        `⚠ TASKDESK_PORT="${rawPort}" is not a valid port (1-65535) — falling back to ${DEFAULT_PORT}`,
      );
    }
    void startServer(port, { role });
  }
}

export type AppType =
  | typeof configApi
  | typeof projectApi
  | typeof projectOverviewApi
  | typeof projectStatesApi
  | typeof projectSettingsInheritanceApi
  | typeof taskApi
  | typeof taskV2Api
  | typeof columnApi
  | typeof activityApi
  | typeof approvalApi
  | typeof attachmentApi
  | typeof auditApi
  | typeof cannedResponseApi
  | typeof commentApi
  | typeof timeEntryApi
  | typeof timeTrackingApi
  | typeof labelApi
  | typeof notificationApi
  | typeof notificationPreferencesApi
  | typeof pendingActionApi
  | typeof userPreferenceApi
  | typeof searchApi
  | typeof serviceCalendarApi
  | typeof slaPolicyApi
  | typeof taskRelationApi
  | typeof externalLinkApi
  | typeof factorStatusApi
  | typeof csrfTokenApi
  | typeof portalCsrfTokenApi
  | typeof publicAgentPreferenceHandoffApi
  | typeof publicPortalPreferenceHandoffApi
  | typeof agentPreferenceHandoffApi
  | typeof portalPreferenceHandoffApi
  | typeof stepUpApi
  | typeof notificationProviderApi
  | typeof observabilityApi
  | typeof metricsTokenRotationApi
  | typeof localFactorPolicyApi
  | typeof authLocalMethodsApi
  | typeof resetMfaApi
  | typeof usersApi
  | typeof hardPurgeApi
  | typeof impersonationApi
  | typeof rotateSecretsApi
  | typeof identityConnectionAdminApi
  | typeof identityConnectionDeletionApi
  | typeof oidcGroupMappingAdminApi
  | typeof scimAdminApi
  | typeof instanceDeliveriesApi
  | typeof instanceDeliveryRequeueApi
  | typeof instanceJobsApi
  | typeof instanceMcpUsageApi
  | typeof importsApi
  | typeof instanceStorageApi
  | typeof mcpTelemetryApi
  | typeof meIdentityApi
  | typeof accountLinkApi
  | typeof publicCspReportApi
  | typeof instancePluginsApi
  | typeof instanceHealthApi
  | typeof instanceSettingsApi
  | typeof organisationCustomerVisibilityApi
  | typeof combinedWorkItemApi
  | typeof organisationLifecycleApi
  | typeof organisationCatalogueApi
  | typeof featureFlagApi
  | typeof automationApi
  | typeof agileApi
  | typeof pagesApi
  | typeof customerInvitationApi
  | typeof portalAuthMethodsApi
  | typeof customerInvitationPublicContinuationApi
  | typeof customerInvitationAcceptContinuationApi
  | typeof apiKeyApi
  | typeof webhookApi
  | typeof webhookSecurityPostureApi
  | typeof webhookRotateAllApi
  | typeof customFieldApi
  | typeof customFieldSectionApi
  | typeof teamApi
  | typeof kbApi
  | typeof portalReleaseApi
  | typeof reportApi
  | typeof scimProtocolApi
  | typeof workflowApi
  | typeof workflowRuleApi
  | typeof workItemRelationApi
  | typeof workItemApi
  | typeof workItemCommentVersionsApi
  | typeof invitationApi
  | typeof workspaceApi
  | typeof workspaceProjectSettingsApi
  | typeof userApi
  | typeof viewApi
  | typeof invitationPublicApi
  | typeof publicTerminologyApi
  | typeof instanceTerminologyApi
  | typeof workspaceTerminologyApi
  | typeof portalTerminologyApi
  | typeof portalNotificationApi
  | typeof intakeApi
  | typeof intakeQueueReadApi
  | typeof intakeQueueRunApi
  | typeof intakeQueueWriteApi
  | typeof requestTypeGroupOrderApi
  | typeof oauthApi
  | typeof capabilitiesApi;

export default app;
