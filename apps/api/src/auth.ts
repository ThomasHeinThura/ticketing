import { createHmac } from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { sendMagicLinkEmail, sendOtpEmail } from "@taskdesk/email";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import {
  admin as adminPlugin,
  emailOTP,
  genericOAuth,
  lastLoginMethod,
  magicLink,
  twoFactor as twoFactorPlugin,
} from "better-auth/plugins";
import type { UserWithAnonymous } from "better-auth/plugins/anonymous";
import { config } from "dotenv-mono";
import { appendAuditLog } from "./audit/audit-writer";
import { authConfigurationVersion } from "./auth/configuration-version";
import {
  IMPERSONATION_SESSION_SECONDS,
  isSanctionedAdminEndpoint,
} from "./auth/impersonation-context";
import { loadLocalFactorState } from "./auth/local-factor-service";
import {
  auditPortalSignInRefusal,
  markUserCreatedInRequest,
  userRowIsDisposable,
  wasUserCreatedInRequest,
} from "./auth/portal-sign-in-refusal";
import { AUTH_RATE_LIMIT } from "./auth/rate-limit-rules";
import {
  completeFirstUserSetup,
  countAuthUsers,
  countAuthUsersForExecutor,
  getAuthUserLocale,
  getCustomerPortalIdentityRow,
  getFirstUserWorkspaceMembership,
  getIdentityConnectionConfigVersions,
  getSetupCompletionMarker,
  getStoredAuthPluginConfigRows,
  hasCustomerSidePerson,
  lockFirstUserPromotion,
  promoteFirstAuthUser,
  updateSessionActiveOrganizationId,
  updateSessionPortal,
} from "./auth/repository";
import {
  establishVerifiedLocalStaffPerson,
  verifiedLocalEmailClaimMethod,
} from "./auth/verified-placeholder-claim";
import { readCustomerInvitationContinuationContext } from "./customer-invitation/continuation-context";
import {
  acceptCustomerInvitation,
  acceptCustomerInvitationFromContinuation,
  validateCustomerInvitationContinuation,
} from "./customer-invitation/service";
import {
  auditSignUpRefusal,
  INVITE_SIGN_UP_REFUSED,
  readInviteSignUpBody,
  verifyInviteSignUp,
} from "./customer-invitation/signup";
import db from "./database";
import {
  bindTwoFactorOidcSession,
  identityOidcPlugin,
  OIDC_PENDING_SESSION_COOKIE,
} from "./identity/oidc-login";
import {
  logTaskDesk,
  recordAuthReload,
} from "./instance/observability/runtime";
import {
  isBootstrapAdminEmail,
  isSetupCompleted,
  SETUP_TOKEN_HEADER,
  verifyAndConsumeSetupToken,
} from "./instance/setup-token";
import {
  afterTotpEnrollmentCommit,
  createCredentialAwareDrizzleAdapter,
  currentAccountDeletionTransaction,
  currentTotpEnrollmentTransaction,
  noteTotpEnrollmentMutationAuditFailure,
  revokeTotpPeerSessions,
  runOrAfterTotpEnrollmentCommit,
  withAccountDeletionTransaction,
  withExplicitCredentialMutation,
  withTotpSessionEnrollment,
} from "./pending-action/credential-invalidation";
import { hasCanonicalCustomerMembership } from "./permissions/customer-membership";
import deleteAccountData from "./user/controllers/delete-account-data";
import { checkRegistrationAllowed } from "./utils/check-registration-allowed";
import { mapCustomOAuthProfileToUser } from "./utils/custom-oauth-profile";
import { getDefaultCookieAttributes } from "./utils/get-default-cookie-attributes";
import { getGithubSsoOAuthCredentials } from "./utils/github-sso-env";
import { consumeAnonymousInvitationRateLimit } from "./utils/invitation-anonymous-rate-limit";
import { isCloud } from "./utils/is-cloud";
import { isDisposableEmail } from "./utils/is-disposable-email";
import { isLocalSignInPath } from "./utils/is-local-sign-in-path";
import { resolveAuthSecret } from "./utils/require-auth-secret";
import { TRUSTED_CLIENT_IP_HEADER } from "./utils/resolve-client-ip";
import { ensureStaffPersonForUser } from "./utils/seed-internal-organisation";
import { invalidateNativeAuthorization } from "./ws";

export function assertCookieDomainIsNotConfiguredForHostIsolation() {
  if (process.env.COOKIE_DOMAIN)
    throw new Error(
      "COOKIE_DOMAIN is incompatible with the host-isolated agent and portal origins.",
    );
}

config();

const githubSso = getGithubSsoOAuthCredentials();

const isRegistrationDisabled = process.env.DISABLE_REGISTRATION === "true";
const isPasswordRegistrationDisabled =
  process.env.DISABLE_PASSWORD_REGISTRATION === "true";
const isLoginFormDisabled = process.env.DISABLE_LOGIN_FORM === "true";
const isEmailOtpSignInDisabled =
  process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true";

/** Whether the bootstrap environment switches email-code sign-in off on both hosts. */
export function isEmailOtpSignInDisabledByEnvironment(): boolean {
  return isEmailOtpSignInDisabled;
}

function normalizeInvitationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^[a-z0-9_-]{1,128}$/i.test(normalized)) return undefined;
  return normalized;
}

function isOAuthCallbackPath(path: unknown): boolean {
  if (typeof path !== "string") return false;
  return path.startsWith("/callback/") || path.startsWith("/oauth2/callback/");
}

function customerInvitationContextFromAuthRequest(ctx: {
  headers?: Headers | null;
  body?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
}) {
  return readCustomerInvitationContinuationContext({
    headers: ctx.headers,
    invitationId:
      ctx.body?.invitationId ??
      ctx.query?.invitationId ??
      ctx.headers?.get("x-taskdesk-invitation-id"),
    callbackURL: ctx.body?.callbackURL ?? ctx.query?.callbackURL,
  });
}

export type AuthPortal = "agent" | "customer";
export type LocalAuthProviders = {
  password: boolean;
  magicLink: boolean;
  emailOtp: boolean;
};

function explicitServerCredentialMutation(
  method: PropertyKey,
  args: unknown[],
) {
  if (method === "deleteApiKey") {
    return { kind: "api_key" as const, route: "/api-key/delete" };
  }
  if (method === "signOut") {
    return { kind: "session" as const, route: "/sign-out" };
  }
  if (method === "revokeSession") {
    return { kind: "session" as const, route: "/revoke-session" };
  }
  if (method === "revokeSessions") {
    return { kind: "session" as const, route: "/revoke-sessions" };
  }
  if (method === "revokeOtherSessions") {
    return { kind: "session" as const, route: "/revoke-other-sessions" };
  }
  if (method === "changePassword") {
    const body = (args[0] as { body?: { revokeOtherSessions?: unknown } })
      ?.body;
    if (body?.revokeOtherSessions === true) {
      return { kind: "session" as const, route: "/change-password" };
    }
  }
  return undefined;
}

/** Keep direct server API calls under the same explicit-revocation boundary as HTTP. */
function withExplicitServerCredentialMutations<T extends object>(
  instance: T,
): T {
  return new Proxy(instance, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "api" || !value || typeof value !== "object") {
        return value;
      }

      return new Proxy(value, {
        get(api, apiMethod, apiReceiver) {
          const method = Reflect.get(api, apiMethod, apiReceiver);
          if (typeof method !== "function") return method;

          return new Proxy(method, {
            apply(targetMethod, thisArgument, args: unknown[]) {
              if (
                apiMethod === "deleteUser" ||
                apiMethod === "deleteUserCallback"
              ) {
                return withAccountDeletionTransaction(() =>
                  Reflect.apply(targetMethod, thisArgument, args),
                );
              }
              if (apiMethod === "verifyTOTP") {
                return withTotpSessionEnrollment(() =>
                  Reflect.apply(targetMethod, thisArgument, args),
                );
              }
              const mutation = explicitServerCredentialMutation(
                apiMethod,
                args,
              );
              if (!mutation) {
                return Reflect.apply(targetMethod, thisArgument, args);
              }

              return withExplicitCredentialMutation(mutation, () =>
                Reflect.apply(targetMethod, thisArgument, args),
              ).then(({ result, state }) => {
                // Better Auth's signOut endpoint deliberately swallows adapter
                // deletion failures. A direct server call must not report success
                // after its atomic credential/action transaction rolled back.
                if (state.deleteFailure) throw state.deleteFailure;
                return result;
              });
            },
          });
        },
      });
    },
  });
}

export type AuthPluginConfigRow = {
  pluginId: string;
  enabled: boolean;
  scope: string;
  portalScope: string | null;
};

const defaultAgentLocalAuthProviders: LocalAuthProviders = {
  password: true,
  magicLink: true,
  emailOtp: !isEmailOtpSignInDisabled,
};
const disabledCustomerLocalAuthProviders: LocalAuthProviders = {
  password: false,
  magicLink: false,
  emailOtp: false,
};

/**
 * The stored local-provider state for one portal, without the agent break-glass guard. God Mode
 * reads it to show exactly what is stored; the runtime always goes through
 * `resolveLocalAuthProviders`, which refuses a configuration without agent password.
 */
export function resolveStoredLocalAuthProviders(
  portal: AuthPortal,
  rows: readonly AuthPluginConfigRow[],
): LocalAuthProviders {
  const pluginIds = [
    ["auth.password", "password"],
    ["auth.magic-link", "magicLink"],
    ["auth.email-otp", "emailOtp"],
  ] as const;
  const defaults =
    portal === "agent"
      ? defaultAgentLocalAuthProviders
      : disabledCustomerLocalAuthProviders;
  const providers = { ...defaults };

  for (const [pluginId, key] of pluginIds) {
    const configuredRows = rows.filter(
      (row) =>
        row.pluginId === pluginId &&
        row.scope === "instance" &&
        (row.portalScope === "both" || row.portalScope === portal),
    );
    if (configuredRows.length === 0) continue;
    providers[key] = configuredRows.some((row) => row.enabled);
  }
  return providers;
}

export function resolveLocalAuthProviders(
  portal: AuthPortal,
  rows: readonly AuthPluginConfigRow[],
): LocalAuthProviders {
  const providers = resolveStoredLocalAuthProviders(portal, rows);

  // Password remains the agent break-glass path. A malformed persisted
  // configuration cannot swap out the last working staff sign-in method.
  if (portal === "agent" && !providers.password) {
    throw new Error("auth.password must remain enabled for the agent portal.");
  }
  return providers;
}

/**
 * The providers a portal can actually serve: `DISABLE_EMAIL_OTP_SIGN_IN` keeps the email-code
 * plugin unmounted (see `createAuth`), so a stored enabled email-otp row must not be advertised
 * or admitted at the host.
 */
export function effectiveLocalAuthProviders(
  providers: LocalAuthProviders,
): LocalAuthProviders {
  return {
    ...providers,
    emailOtp: providers.emailOtp && !isEmailOtpSignInDisabled,
  };
}

const agentOrigin = process.env.TASKDESK_AGENT_URL || "http://localhost:5173";
const customerOrigin =
  process.env.TASKDESK_PORTAL_URL || "http://localhost:5174";

const authSecretResult = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);

if (!authSecretResult.ok) {
  console.error(authSecretResult.reason);
  process.exit(1);
}

const authSecret = authSecretResult.secret;

export async function hasCustomerPortalIdentity(userId: string) {
  const rows = await getCustomerPortalIdentityRow(userId);
  const person = rows[0];
  return (
    person !== undefined &&
    person.side === "customer" &&
    person.personActive &&
    !person.isPlaceholder &&
    person.organisationActive &&
    person.organisationPortalAccess &&
    person.organisationDeletedAt === null &&
    rows.every(
      (row) =>
        row.personId === person.personId &&
        row.organisationId === person.organisationId,
    ) &&
    hasCanonicalCustomerMembership(
      person.organisationId,
      rows.map((row) => ({
        scope: row.scope,
        scopeId: row.scopeId,
        seesAll: row.seesAll,
        roleId: row.roleId,
        roleKey: row.roleKey,
        roleScope: row.roleScope,
        roleWorkspaceId: row.roleWorkspaceId,
        roleIsSystem: row.roleIsSystem,
        scopeExists:
          row.scope === "organisation" && row.scopeId === person.organisationId,
        rank: row.roleRank,
        capabilities: row.roleCapabilities,
      })),
    )
  );
}

/** Sign narrowly scoped CSRF tokens without exposing Better Auth's root secret. */
export function signCsrfPayload(payload: string): string {
  return createHmac("sha256", authSecret)
    .update("taskdesk:csrf:v1\0", "utf8")
    .update(payload, "utf8")
    .digest("base64url");
}

export function getConfiguredAgentOrigin(): string {
  return new URL(agentOrigin).origin;
}

export function getConfiguredCustomerOrigin(): string {
  return new URL(customerOrigin).origin;
}

async function getUserLocale(email: string) {
  const [user] = await getAuthUserLocale(email);

  return user?.locale ?? null;
}

function getLocaleKey(locale?: string | null) {
  const normalized = locale?.toLowerCase();
  if (normalized?.startsWith("de")) return "de";
  if (normalized?.startsWith("vi")) return "vi";
  if (normalized?.startsWith("ja")) return "ja";
  return "en";
}

function getAuthEmailCopy(locale?: string | null) {
  const localeKey = getLocaleKey(locale);

  if (localeKey === "de") {
    return {
      magicLinkSubject: "Anmeldelink fuer TaskDesk",
      otpSubject: "Bestaetigungscode fuer TaskDesk",
    };
  }

  if (localeKey === "vi") {
    return {
      magicLinkSubject: "Liên kết đăng nhập TaskDesk",
      otpSubject: "Mã xác minh TaskDesk",
    };
  }

  if (localeKey === "ja") {
    return {
      magicLinkSubject: "TaskDesk ログインリンク",
      otpSubject: "TaskDesk 認証コード",
    };
  }

  return {
    magicLinkSubject: "Login for TaskDesk",
    otpSubject: "Authentication code for TaskDesk",
  };
}

function createAuth(
  portal: AuthPortal,
  localAuthProviders: LocalAuthProviders = portal === "agent"
    ? defaultAgentLocalAuthProviders
    : disabledCustomerLocalAuthProviders,
) {
  const baseURL = portal === "agent" ? agentOrigin : customerOrigin;
  const instance = betterAuth({
    baseURL,
    trustedOrigins: [baseURL],
    secret: authSecret,
    basePath: "/api/auth",
    database: createCredentialAwareDrizzleAdapter(),
    user: {
      additionalFields: {
        locale: {
          type: "string",
          input: true,
          required: false,
        },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          currentAccountDeletionTransaction();
          await deleteAccountData(user.id);
        },
      },
    },
    account: {
      accountLinking: {
        // Disabled in #6. kaneo shipped `enabled: true` with `trustedProviders`
        // including "custom" — the generic OIDC provider an operator configures.
        // Trusting it means anyone who can register the victim's email address at
        // that provider takes over the existing local account. The
        // `requireLocalEmailVerified` mitigation did not close it either: kaneo
        // enforces no email verification anywhere, and magic-link and email-OTP
        // sign-in both set emailVerified: true, so nearly every account already
        // satisfied the precondition.
        //
        // TaskDesk's identity design is Microsoft Entra OIDC with explicit
        // connection configuration; deliberate linking, if it is ever wanted,
        // gets its own specification.
        enabled: false,
      },
    },
    emailAndPassword: {
      enabled: localAuthProviders.password,
      // The portal's sign-up door is open only to an invitation-gated request: the `before` hook
      // and the user-create guard below refuse every customer sign-up that does not carry a live
      // customer invitation credential for the same address (CP-12, CP-24).
      disableSignUp: false,
      autoSignIn: true,
      password: {
        hash: async (password) => {
          return await bcrypt.hash(password, 10);
        },
        verify: async ({ hash, password }) => {
          return await bcrypt.compare(password, hash);
        },
      },
    },
    socialProviders:
      portal === "agent"
        ? {
            github: {
              clientId: githubSso.clientId,
              clientSecret: githubSso.clientSecret,
              scope: ["user:email"],
            },
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID || "",
              clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            },
            discord: {
              clientId: process.env.DISCORD_CLIENT_ID || "",
              clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
            },
          }
        : {},
    plugins: [
      identityOidcPlugin(portal),
      // anonymous() guest sign-in removed in #6. kaneo enabled it BY DEFAULT —
      // it was opt-OUT via DISABLE_GUEST_ACCESS. It minted a real user row, which
      // also let a guest arriving first consume the zero-user first-run window and
      // permanently lock an instance out of ever gaining an admin (see #18).
      ...(portal === "agent" ? [lastLoginMethod()] : []),
      ...(localAuthProviders.magicLink
        ? [
            magicLink({
              // Customer account creation is gated in the user-create hook by a live
              // browser-bound invitation continuation and exact verified address.
              disableSignUp: false,
              sendMagicLink: async ({ email, url }) => {
                try {
                  const locale = await getUserLocale(email);
                  const copy = getAuthEmailCopy(locale);
                  await sendMagicLinkEmail(email, copy.magicLinkSubject, {
                    magicLink: url,
                    locale,
                  });
                } catch {
                  logTaskDesk({
                    module: "auth",
                    message: "auth.failure",
                    level: "error",
                    result: "failed",
                  });
                }
              },
            }),
          ]
        : []),
      twoFactorPlugin({
        issuer: "TaskDesk",
        skipVerificationOnEnable: false,
        // Better Auth checks for a stored credential password when this is
        // enabled. SSO-only accounts can enroll a local factor without a
        // password they never had; credential accounts still have to verify it.
        allowPasswordless: true,
        // Trusted-device cookies would create a factor bypass across session
        // revocation and runtime policy changes. Every protected login must verify.
        trustDeviceMaxAge: 0,
      }),
      ...(localAuthProviders.emailOtp && !isEmailOtpSignInDisabled
        ? [
            emailOTP({
              // Customer account creation is gated in the user-create hook by a live
              // browser-bound invitation continuation and exact verified address.
              disableSignUp: false,
              async sendVerificationOTP({ email, otp, type }) {
                if (type === "sign-in") {
                  const locale = await getUserLocale(email);
                  const copy = getAuthEmailCopy(locale);
                  await sendOtpEmail(email, copy.otpSubject, {
                    otp,
                    locale,
                  });
                }
              },
            }),
          ]
        : []),
      ...(portal === "agent"
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "custom",
                  clientId: process.env.CUSTOM_OAUTH_CLIENT_ID || "",
                  clientSecret: process.env.CUSTOM_OAUTH_CLIENT_SECRET,
                  authorizationUrl:
                    process.env.CUSTOM_OAUTH_AUTHORIZATION_URL || "",
                  tokenUrl: process.env.CUSTOM_OAUTH_TOKEN_URL || "",
                  userInfoUrl: process.env.CUSTOM_OAUTH_USER_INFO_URL || "",
                  scopes: process.env.CUSTOM_OAUTH_SCOPES?.split(",")
                    .map((s) => s.trim())
                    .filter(Boolean) || ["profile", "email"],
                  responseType:
                    process.env.CUSTOM_OAUTH_RESPONSE_TYPE || "code",
                  discoveryUrl: process.env.CUSTOM_OAUTH_DISCOVERY_URL || "",
                  pkce: process.env.CUSTOM_AUTH_PKCE !== "false",
                  mapProfileToUser: mapCustomOAuthProfileToUser,
                },
              ],
            }),
          ]
        : []),
      // bearer() removed in #6. It emitted the raw session token in a
      // `set-auth-token` response header with Access-Control-Expose-Headers on
      // every auth response. Combined with kaneo's credentialed CORS reflection
      // that was cross-origin session theft with no XSS required — finding C3 of
      // the PR #13 review. The CORS fix broke the chain; this closes it.
      ...(portal === "agent"
        ? [
            apiKey({
              // NEVER true. webhooks-and-api-keys.md specifies `sessionOnly` routes that
              // must answer "403 session_required from an API or MCP key" — which is
              // only possible if a key is not a session. kaneo minted a full session
              // from an API key, making it a third authentication surface larger than
              // the two removed above.
              enableSessionForAPIKeys: false,
              apiKeyHeaders: "x-api-key",
              // AK-8: keys authenticate as `Authorization: Bearer tdk_…`. Keys issued through
              // `/api/me/api-keys` carry the same prefix (`api-key/service.ts`).
              defaultPrefix: "tdk_",
              rateLimit: {
                enabled: true,
                maxRequests: 100,
                timeWindow: 60 * 1000,
              },
            }),
          ]
        : []),
      // deviceAuthorization() removed in #6. mcp-server.md MC-3 puts an OAuth
      // device flow explicitly out of scope — "a whole authentication mechanism".
      // It also laundered an API key into a session token that outlived the key's
      // own revocation (#17).
      ...(portal === "agent"
        ? [
            adminPlugin({
              defaultRole: "user",
              adminRoles: ["admin"],
              // GM-7: an impersonation session is capped at 30 minutes. Administrators are
              // never impersonable (GM-10), so `allowImpersonatingAdmins` stays at its
              // default of false.
              impersonationSessionDuration: IMPERSONATION_SESSION_SECONDS,
            }),
          ]
        : []),
      // openAPI() removed in #6. It mounted an unauthenticated
      // /api/auth/reference that pulls an UNPINNED @scalar/api-reference bundle
      // from a third-party CDN into the API's own cookie origin.
    ],
    session: {
      // Cookie cache disabled in #6. kaneo cached the session in the cookie for
      // five minutes, and that path returns session data with NO database read —
      // so a revoked session kept working for up to five minutes, and a forged
      // cookie was never compared against any row. Revocation has to be immediate.
      cookieCache: {
        enabled: false,
      },
      // S10: `activeOrganizationId` is a genuine, permanent column
      // (schema.ts's sessionTable) that this app's own hooks write directly via
      // Drizzle -- it was never owned by the `organization()` plugin. But
      // better-auth's `GET /get-session` response is filtered through
      // `parseSessionOutput`, which only returns a session column if it is
      // either one of better-auth's own core fields or explicitly declared
      // here or by a still-registered plugin's own `schema.session.fields`
      // (`db/schema.mjs`'s `getFields`). The `organization()` plugin used to
      // declare this field as a side effect of its own schema, so removing it
      // silently dropped `activeOrganizationId` from every session response
      // the client ever sees -- the column and the value are both still
      // written and read correctly server-side, but the client's
      // `useActiveWorkspace()` (via `getActiveOrganizationId`) saw `undefined`
      // for it on any page with no workspace id in its own URL. Declaring it
      // here restores exactly the visibility the plugin used to provide for
      // free, now that nothing else does.
      //
      // `input: false` IS LOAD-BEARING, not copied boilerplate. The
      // organization() plugin declared this exact field with `input: false`
      // too (organization.mjs:827-832) -- the first version of this fix
      // omitted it, and an independent review caught, then proved, the
      // consequence: better-auth's generic `POST /api/auth/update-session`
      // reads `getFields(..., "input")`, which only refuses a field when
      // `input === false`; without it, ANY authenticated caller could
      // overwrite their OWN session's `activeOrganizationId` to a workspace
      // they are not a member of, with no membership check at all --
      // bypassing the one sanctioned path (`POST /api/workspace/{id}/activate`,
      // gated by `requireWorkspaceMembership`) entirely. `input: false` here
      // makes `update-session` refuse the field with 400 `FIELD_NOT_ALLOWED`,
      // exactly matching the plugin's own prior behaviour, while leaving the
      // OUTPUT side (what this field exists for) completely unaffected --
      // `getFields`'s "output" mode does not consult `input` at all.
      //
      // `activeTeamId` deliberately gets NO equivalent declaration here. The
      // plugin exposed it too, but nothing ever reads it -- confirmed by
      // grepping the whole of apps/api/src and apps/web/src -- so it is now
      // silently absent from `GET /get-session`'s response, same column,
      // same write path, just no longer visible to a client that never asked
      // for it. If a future consumer needs it, add it here the same way.
      additionalFields: {
        portal: {
          type: "string",
          required: true,
          defaultValue: portal,
          input: false,
        },
        activeOrganizationId: {
          type: "string",
          required: false,
          input: false,
        },
        identityConnectionId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    rateLimit: {
      // Enabled for EVERY deployment. kaneo used `enabled: isCloud()`, so
      // authentication abuse protection was off for exactly the shape TaskDesk
      // ships — self-hosted — and the sign-up and invite throttles below, which
      // exist specifically to stop abuse, were inert.
      //
      // This is deliberately landed in the SAME change as the client-IP fix
      // above. Enabling a limiter whose key a caller can choose achieves
      // nothing: it would only have handed attackers a free key-rotation
      // primitive. Identity first, then the limit.
      ...AUTH_RATE_LIMIT,
      customRules: { ...AUTH_RATE_LIMIT.customRules },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({ data: { ...session, portal } }),
        },
        delete: {
          after: async (session) => {
            await runOrAfterTotpEnrollmentCommit(() =>
              invalidateNativeAuthorization({ userId: session.userId }),
            );
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            // The anonymous() plugin creates ephemeral users for guest
            // access; registration limits don't apply to them (guest
            // availability is governed by DISABLE_GUEST_ACCESS instead).
            // `isAnonymous` is `input: false` in the plugin schema, so a
            // regular signup request cannot spoof it.
            const userWithAnonymous = user as Partial<UserWithAnonymous>;
            if (userWithAnonymous.isAnonymous) {
              return;
            }

            if (portal === "customer") {
              const creationPath =
                ctx?.path === "/sign-up/email" ||
                ctx?.path === "/magic-link/verify" ||
                ctx?.path === "/sign-in/email-otp";
              const invitationContext = creationPath
                ? customerInvitationContextFromAuthRequest(ctx)
                : null;
              if (
                invitationContext &&
                (await validateCustomerInvitationContinuation({
                  ...invitationContext,
                  email: user.email,
                }))
              ) {
                // The invite fragment proves this address was invited. For password signup it is
                // the email-link proof; the OTP/magic-link plugins reach user creation only after
                // verifying their own address possession. The OIDC callback has its own explicit
                // email_verified check and does not pass through this Better Auth hook.
                // This hook only runs when no row exists, so the row is this request's own: a
                // refused sign-in may clean up only what it created (P3-R1-01).
                markUserCreatedInRequest(ctx, user.email);
                return { data: { ...user, emailVerified: true } };
              }
              if (ctx?.path === "/sign-up/email") {
                const verdict = await verifyInviteSignUp({
                  body: ctx.body,
                  email: user.email,
                });
                if (verdict.ok) {
                  markUserCreatedInRequest(ctx, user.email);
                  return { data: { ...user, emailVerified: true } };
                }
              }
              throw new APIError("FORBIDDEN", {
                message: "Customer accounts must be invited or provisioned.",
              });
            }

            // Zero users can mean two different things, and only one of them
            // is the legitimate first-run bootstrap (#18):
            //   - a genuinely fresh instance, never set up -- OR
            //   - every admin was deleted from an instance that WAS already
            //     set up, which must never re-open this window.
            // `instance_setting.setup_completed_at` is the durable marker that
            // tells them apart; it is never cleared by deleting user rows.
            const [userCountRow] = await countAuthUsers();
            const existingUserCount = userCountRow?.value ?? 0;

            // Computed once, up front, so the SAME call with the SAME
            // arguments is what decides every refusal message below --
            // zero-user or not. See the #18 security review (D1) comment on
            // the throw sites for why this matters.
            const invitationId = normalizeInvitationId(
              ctx?.body?.invitationId ||
                ctx?.query?.invitationId ||
                ctx?.headers?.get("x-invitation-id"),
            );

            if (existingUserCount === 0 && !(await isSetupCompleted())) {
              // This is the one-time bootstrap. It is allowed through even
              // when DISABLE_REGISTRATION / DISABLE_PASSWORD_REGISTRATION are
              // set -- but ONLY on proof of authorization: the operator's
              // headless-install email, or the setup token printed to the
              // container log (auth-and-identity.md § Break-glass). There is
              // no other bypass; an unauthorized zero-user signup is refused
              // below exactly like any other signup would be.
              if (isBootstrapAdminEmail(user.email)) {
                return;
              }

              const presentedToken = ctx?.headers?.get(SETUP_TOKEN_HEADER);
              if (await verifyAndConsumeSetupToken(presentedToken)) {
                return;
              }

              // #18 security review (B1, then D1): this refusal must be
              // impossible to distinguish from an ordinary registration
              // refusal, for EVERY shape of request, not just the plain one.
              // B1's first fix hard-coded one fixed message here -- which
              // closed the plain case but reopened the same oracle the moment
              // a caller added an `invitationId`: checkRegistrationAllowed
              // below has two different messages (no invitation attempted vs.
              // an invitation that didn't resolve), and a claimed instance
              // reaches it while an unclaimed one used to short-circuit here
              // first with only ever the first message -- so which of the two
              // messages came back told an attacker claimed from unclaimed
              // just as reliably as the original, more obviously-named one
              // did. On a genuinely empty instance no invitation can ever
              // exist (nothing has created a workspace or sent one yet), so
              // calling the SAME function with the SAME arguments here always
              // reproduces whichever of its two refusal messages a claimed
              // instance would give for that identical request shape, because
              // it is literally the same call. When registration is open
              // (DISABLE_REGISTRATION=false), that call would itself say
              // "allowed" -- but there is no message to mirror in that branch
              // either, since a claimed+open instance would answer with 200,
              // not an error body, so this falls back to the same fixed
              // refusal text as before; the remaining 200-vs-403 signal in
              // that specific configuration is inherent to never letting an
              // unauthenticated signup through on an unclaimed instance, not
              // something a message change can close. The setup URL and token
              // are still printed to the boot log (ensureSetupToken) and
              // documented in the runbook -- an operator never needs this
              // response to learn them.
              const bootstrapRefusal = await checkRegistrationAllowed(
                user.email,
                invitationId,
                { allowInvitationByEmail: isOAuthCallbackPath(ctx?.path) },
              );
              throw new APIError("FORBIDDEN", {
                message: bootstrapRefusal.allowed
                  ? "Registration is currently disabled. Please use a valid invitation link to create an account."
                  : bootstrapRefusal.reason,
              });
            }

            const result = await checkRegistrationAllowed(
              user.email,
              invitationId,
              { allowInvitationByEmail: isOAuthCallbackPath(ctx?.path) },
            );
            if (!result.allowed) {
              throw new APIError("FORBIDDEN", {
                message: result.reason,
              });
            }
          },
          after: async (user, context) => {
            // The anonymous() plugin creates ephemeral users for guest
            // access; never promote one to instance admin even if no
            // real admin exists yet. `isAnonymous` is contributed by the
            // anonymous plugin's `additionalFields` and isn't part of the
            // base User type, so we narrow through `UserWithAnonymous`.
            const userWithAnonymous = user as Partial<UserWithAnonymous>;
            if (userWithAnonymous.isAnonymous) {
              return;
            }

            if (portal === "customer") return;

            // Promote the first user to instance admin atomically.
            //
            // A previous version of this code checked the user count in
            // the `before` hook and returned `role: "admin"`, but the
            // count and the eventual INSERT happened in separate
            // transactions, so two concurrent first-signups could both
            // see count=0 and both become admins (qodo bot #5).
            //
            // We now run the check + promote inside a single transaction
            // guarded by a Postgres advisory lock. Whichever transaction
            // wins the lock first promotes its user; any concurrent
            // transaction then sees totalUserCount > 1 and skips.
            //
            // Note: we count total users (not admins) so that upgrading
            // an existing instance (where every existing user has
            // role=NULL from the new column) doesn't promote the next
            // signup to admin (qodo bot #4).
            //
            // #18: also re-check `setup_completed_at` INSIDE the lock. Without
            // this, deleting every admin from an already-set-up instance would
            // let the next signup silently re-trigger admin auto-promotion --
            // exactly the durable-marker guarantee this column exists for.
            await db.transaction(async (tx) => {
              await lockFirstUserPromotion(tx);

              const totalRows = await countAuthUsersForExecutor(tx);
              const totalUserCount = totalRows[0]?.value ?? 0;

              const [setting] = await getSetupCompletionMarker(tx);
              const setupAlreadyCompleted = setting?.setupCompletedAt != null;

              // This hook runs after the user row is inserted, so the
              // just-created user is included in the count. If they are
              // the only row in the table, and the instance has never
              // completed setup, this is the fresh-instance bootstrap and
              // they get promoted to admin.
              if (totalUserCount === 1 && !setupAlreadyCompleted) {
                await promoteFirstAuthUser(tx, user.id);
                await completeFirstUserSetup(tx);
              }
            });

            // #315 S7 / #324: boot seeding alone misses local users who register
            // after startup. The current local password-signup path creates ordinary
            // internal staff identities. Do not infer a staff identity for OAuth
            // callbacks: their portal and organisation must come from a configured
            // identity connection, which owns that provisioning decision.
            if (context?.path === "/sign-up/email") {
              await ensureStaffPersonForUser(user.id);
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The admin plugin is kept as a session primitive only (role, banned,
        // impersonatedBy fields and ban enforcement). Its HTTP endpoints
        // (set-role, create-user, set-user-password, impersonate-user,
        // remove-user, ban-user, ...) bypass step-up, eligibility checks and
        // audit, so every `/admin/*` endpoint is refused here. `ctx.path` is
        // the matched endpoint path, so encoding/case/slash variants either
        // resolve to this same path (and are refused) or match nothing (404).
        // Authority for these operations lives in `/api/instance/*`.
        if (
          (ctx.path === "/admin" || ctx.path.startsWith("/admin/")) &&
          !isSanctionedAdminEndpoint(ctx.path)
        ) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
        }

        if (ctx.path === "/two-factor/enable" && ctx.context.session?.user.id) {
          const state = await loadLocalFactorState(ctx.context.session.user.id);
          if (state.policy.mode === "off") {
            throw new APIError("FORBIDDEN", {
              message:
                "Local factor enrollment is disabled by instance policy.",
            });
          }
        }

        if (
          ctx.path === "/two-factor/disable" ||
          ctx.path === "/two-factor/generate-backup-codes"
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "A factor-bound confirmation is required for this operation.",
          });
        }

        if (
          ctx.path === "/two-factor/enable" &&
          ctx.context.session?.user.twoFactorEnabled
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "An enrolled factor cannot be replaced through enrollment.",
          });
        }

        if (isLoginFormDisabled && isLocalSignInPath(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            message:
              "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
          });
        }

        if (portal === "customer" && ctx.path === "/sign-up/email") {
          const invitationContext =
            customerInvitationContextFromAuthRequest(ctx);
          const continuationValid =
            invitationContext !== null &&
            (await validateCustomerInvitationContinuation({
              ...invitationContext,
              email: ctx.body?.email,
            }));
          if (!continuationValid) {
            // CP-26 retains the legacy raw-credential flow's trusted-IP budget. A verified
            // one-use continuation has already consumed that same budget at its public handoff.
            let invitationRate: Awaited<
              ReturnType<typeof consumeAnonymousInvitationRateLimit>
            >;
            try {
              invitationRate = await consumeAnonymousInvitationRateLimit(
                ctx.headers?.get(TRUSTED_CLIENT_IP_HEADER) ?? null,
              );
            } catch {
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "Invitation rate limit unavailable",
              });
            }
            if (!invitationRate.allowed)
              throw new APIError("TOO_MANY_REQUESTS", {
                message: "Too many requests. Please try again later.",
              });
            const verdict = await verifyInviteSignUp({
              body: ctx.body,
              email: ctx.body?.email,
            });
            if (!verdict.ok) {
              await auditSignUpRefusal(
                verdict,
                readInviteSignUpBody(ctx.body)?.invitationId ?? null,
              );
              throw new APIError("FORBIDDEN", {
                message: INVITE_SIGN_UP_REFUSED,
              });
            }
          }
          return;
        }

        const isSignUpPath =
          ctx.path === "/sign-up/email" ||
          ctx.path.startsWith("/callback/") ||
          ctx.path.startsWith("/sign-in/social");

        if (!isSignUpPath) {
          return;
        }

        const userCountRows = await countAuthUsers();
        const existingUserCount = userCountRows[0]?.value ?? 0;
        const isInstanceAdminSetup = existingUserCount === 0;

        if (ctx.path === "/sign-up/email") {
          if (isPasswordRegistrationDisabled && !isInstanceAdminSetup) {
            throw new APIError("FORBIDDEN", {
              message:
                "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
            });
          }

          // Cloud-only abuse gates on password signup. Self-hosted instances
          // leave KANEO_CLOUD unset and skip it.
          if (isCloud() && !isInstanceAdminSetup) {
            const signupEmail = (ctx.body?.email as string | undefined) ?? "";
            if (signupEmail && isDisposableEmail(signupEmail)) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Sign-up with disposable email addresses is not allowed.",
              });
            }
          }
        }

        if (!isRegistrationDisabled || isInstanceAdminSetup) {
          return;
        }

        const email =
          ctx.body?.email ||
          ctx.query?.email ||
          ctx.headers?.get("x-invitation-email");
        const invitationId = normalizeInvitationId(
          ctx.body?.invitationId ||
            ctx.query?.invitationId ||
            ctx.headers?.get("x-invitation-id"),
        );

        if (ctx.path === "/sign-up/email") {
          const result = await checkRegistrationAllowed(email, invitationId);
          if (!result.allowed) {
            throw new APIError("FORBIDDEN", {
              message: result.reason,
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const newSession = ctx.context.newSession;
        const previousSession = ctx.context.session;
        const completedEnrollment =
          ctx.path === "/two-factor/verify-totp" &&
          previousSession?.user.twoFactorEnabled !== true &&
          newSession?.user.twoFactorEnabled === true;
        if (completedEnrollment && newSession) {
          // Better Auth replaces the session used to verify enrollment. Revoke any
          // verified factor gates every device. The shared transaction locks the
          // PA lifecycle gate first and terminalizes actions before deleting peers.
          const tx = currentTotpEnrollmentTransaction();
          await revokeTotpPeerSessions(
            newSession.user.id,
            newSession.session.id,
          );
          afterTotpEnrollmentCommit(() =>
            invalidateNativeAuthorization({ userId: newSession.user.id }),
          );
          try {
            await tx.transaction(async (auditTx) =>
              appendAuditLog(auditTx, {
                action: "auth.mfa_enrolled",
                actorId: newSession.user.id,
                actorType: "person",
                workspaceId: null,
                entityType: "person",
                entityId: newSession.user.id,
                after: { method: "totp" },
              }),
            );
          } catch {
            noteTotpEnrollmentMutationAuditFailure();
          }
        }
        if (!newSession) return;

        const customerInvitationCreationPath =
          ctx.path === "/sign-up/email" ||
          ctx.path === "/sign-in/email-otp" ||
          ctx.path === "/magic-link/verify";
        const verifiedClaimMethod = verifiedLocalEmailClaimMethod(ctx.path);
        if (portal === "customer" && customerInvitationCreationPath) {
          // Provider proof and the browser-bound invite context must both still be valid. The
          // existing acceptance transaction creates the customer person/grant and consumes the
          // invitation before this request can return its customer session.
          const invitationContext =
            customerInvitationContextFromAuthRequest(ctx);
          // A returning admitted customer needs fresh provider proof, not a new
          // invitation. New identities still require the bound invitation below.
          let accepted =
            !invitationContext &&
            (await hasCustomerPortalIdentity(newSession.user.id));
          if (invitationContext) {
            try {
              await acceptCustomerInvitationFromContinuation({
                userId: newSession.user.id,
                ...invitationContext,
                ...(verifiedClaimMethod ? { verifiedClaimMethod } : {}),
                ...(ctx.path === "/sign-up/email"
                  ? { via: "sign_up" as const }
                  : {}),
              });
              accepted = true;
            } catch {
              accepted = false;
            }
          } else if (ctx.path === "/sign-up/email") {
            const presented = readInviteSignUpBody(ctx.body);
            if (presented) {
              try {
                await acceptCustomerInvitation({
                  userId: newSession.user.id,
                  invitationId: presented.invitationId,
                  credential: presented.credential,
                  via: "sign_up",
                });
                accepted = true;
              } catch {
                accepted = false;
              }
            }
          }
          if (!accepted) {
            // Only a row inserted by this very request and carrying no other data may be removed.
            // An existing account (staff, instance admin, deactivated customer, customer whose
            // organisation lost portal access) keeps its row, keys and memberships: its new
            // session is revoked and the refusal audited (P3-R1-01).
            if (
              wasUserCreatedInRequest(ctx, newSession.user.email) &&
              Date.now() - new Date(newSession.user.createdAt).getTime() <
                60_000 &&
              (await userRowIsDisposable(newSession.user.id)) &&
              !(await hasCustomerPortalIdentity(newSession.user.id))
            ) {
              await ctx.context.internalAdapter.deleteUser(newSession.user.id);
            } else {
              await ctx.context.internalAdapter.deleteSession(
                newSession.session.token,
              );
              await auditPortalSignInRefusal(
                newSession.user.id,
                "customer_identity_unavailable",
              );
            }
            deleteSessionCookie(ctx, true);
            ctx.context.setNewSession(null);
            throw new APIError("FORBIDDEN", {
              message: INVITE_SIGN_UP_REFUSED,
            });
          }
        }

        if (
          portal === "customer" &&
          !(await hasCustomerPortalIdentity(newSession.user.id))
        ) {
          await ctx.context.internalAdapter.deleteSession(
            newSession.session.token,
          );
          await auditPortalSignInRefusal(
            newSession.user.id,
            "customer_identity_unavailable",
          );
          deleteSessionCookie(ctx, true);
          ctx.context.setNewSession(null);
          return;
        }

        if (
          portal === "agent" &&
          (await hasCustomerSidePerson(newSession.user.id))
        ) {
          // A customer-side person never holds an agent session: the agent host admits staff
          // only (P3-R1-08). The account itself is untouched.
          await ctx.context.internalAdapter.deleteSession(
            newSession.session.token,
          );
          await auditPortalSignInRefusal(
            newSession.user.id,
            "customer_on_agent_host",
          );
          deleteSessionCookie(ctx, true);
          ctx.context.setNewSession(null);
          return;
        }

        const factorVerifiedEndpoint =
          ctx.path === "/two-factor/verify-totp" ||
          ctx.path === "/two-factor/verify-backup-code";
        const passwordSignInPath =
          ctx.path === "/sign-in/email" ||
          ctx.path === "/sign-in/username" ||
          ctx.path === "/sign-in/phone-number";
        if (
          newSession.user.twoFactorEnabled &&
          !factorVerifiedEndpoint &&
          !passwordSignInPath
        ) {
          // The plugin's built-in sign-in gate covers password sign-in. Other
          // credential flows may not establish that challenge; refuse their
          // session rather than let a local factor be skipped.
          await ctx.context.internalAdapter.deleteSession(
            newSession.session.token,
          );
          deleteSessionCookie(ctx, true);
          ctx.context.setNewSession(null);
          return;
        }

        const totpTransaction =
          ctx.path === "/two-factor/verify-totp"
            ? currentTotpEnrollmentTransaction()
            : null;
        if (portal === "agent" && verifiedClaimMethod) {
          try {
            await establishVerifiedLocalStaffPerson({
              userId: newSession.user.id,
              verifiedEmail: newSession.user.email,
              method: verifiedClaimMethod,
            });
          } catch {
            await ctx.context.internalAdapter.deleteSession(
              newSession.session.token,
            );
            deleteSessionCookie(ctx, true);
            ctx.context.setNewSession(null);
            throw new APIError("FORBIDDEN", {
              message: "Sign-in is unavailable for this account.",
            });
          }
        }
        const sessionWriter = totpTransaction ?? db;
        await updateSessionPortal(sessionWriter, newSession.session.id, portal);

        if (factorVerifiedEndpoint) {
          const factorCookie = ctx.context.createAuthCookie("two_factor");
          let challengeId: string | null = null;
          try {
            const value = await ctx.getSignedCookie(
              factorCookie.name,
              ctx.context.secret,
            );
            challengeId = typeof value === "string" ? value : null;
          } catch {
            challengeId = null;
          }
          const sourceCookie = ctx.context.createAuthCookie(
            OIDC_PENDING_SESSION_COOKIE,
          );
          let sourceMarker: string | null = null;
          try {
            const value = await ctx.getSignedCookie(
              sourceCookie.name,
              ctx.context.secret,
            );
            sourceMarker = typeof value === "string" ? value : null;
          } catch {
            sourceMarker = null;
          }
          const provenance = await bindTwoFactorOidcSession(
            {
              challengeId,
              sourceMarker,
              sessionId: newSession.session.id,
              userId: newSession.user.id,
              portal,
            },
            totpTransaction ?? undefined,
          );
          if (provenance === "invalid") {
            await ctx.context.internalAdapter.deleteSession(
              newSession.session.token,
            );
            deleteSessionCookie(ctx, true);
            ctx.setCookie(sourceCookie.name, "", {
              ...sourceCookie.attributes,
              maxAge: 0,
            });
            ctx.context.setNewSession(null);
            return;
          }
          if (sourceMarker) {
            ctx.setCookie(sourceCookie.name, "", {
              ...sourceCookie.attributes,
              maxAge: 0,
            });
          }
        }

        if (
          ctx.path.startsWith("/sign-up") ||
          ctx.path.startsWith("/sign-in") ||
          factorVerifiedEndpoint
        ) {
          const workspaceMember = await getFirstUserWorkspaceMembership(
            newSession.user.id,
          );

          const activeWorkspaceId = workspaceMember[0]?.workspaceId || null;

          if (activeWorkspaceId) {
            await updateSessionActiveOrganizationId(
              sessionWriter,
              newSession.session.id,
              activeWorkspaceId,
            );
          }
        }
      }),
    },
    advanced: {
      ipAddress: {
        // ONLY the internal header, which utils/auth-request.ts strips from every
        // inbound request and then sets from utils/resolve-client-ip.ts.
        //
        // kaneo read ["cf-connecting-ip", "x-forwarded-for"] against a CIDR set
        // that defaulted to all of RFC1918. `cf-connecting-ip` is single-valued
        // and unvalidatable, so a caller chose its own rate-limit bucket and
        // could rotate it per request; and a CIDR set is the wrong shape anyway,
        // because on a shared cluster every pod is inside RFC1918.
        //
        // TASKDESK_TRUST_PROXY is a HOP COUNT, per configuration-reference.md,
        // and counting from the right is the only derivation a caller cannot
        // prepend to. No trustedProxies list: the value here is already resolved.
        ipAddressHeaders: [TRUSTED_CLIENT_IP_HEADER],
      },
      // The explicit __Host names already carry the secure prefix; suppress
      // Better Auth's automatic __Secure- name prefix while keeping Secure attrs.
      useSecureCookies: false,
      cookiePrefix: "",
      cookies: {
        session_token: {
          name:
            portal === "agent"
              ? "__Host-tdk_agent_session"
              : "__Host-tdk_portal_session",
          attributes: {
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
          },
        },
      },
      defaultCookieAttributes: getDefaultCookieAttributes(),
    },
  });
  return withExplicitServerCredentialMutations(instance);
}

export let auth = createAuth("agent");
export let portalAuth = createAuth("customer");
let customerLocalAuthProviders = disabledCustomerLocalAuthProviders;
// What the agent Better Auth instance of this replica serves; `/api/config` follows it so the staff
// sign-in page never offers a method whose endpoint is not mounted (R5 keeps password on).
let agentLocalAuthProviders = effectiveLocalAuthProviders(
  defaultAgentLocalAuthProviders,
);

let authConfigVersion = -1;
let authConfigFingerprint: string | null = null;
let authReloadPromise: Promise<boolean> | null = null;
let authReloadFollowUp: Promise<boolean> | null = null;
let authConfigPoller: ReturnType<typeof setInterval> | null = null;

/** Build a fresh pair from the stored, portal-scoped auth plugin rows. */
export async function reloadAuthConfiguration(): Promise<boolean> {
  if (authReloadPromise) {
    // The reload in flight may have read the rows before the caller's change committed, so one
    // more reload runs after it. Callers arriving meanwhile share that single follow-up.
    authReloadFollowUp ??= authReloadPromise
      .catch(() => false)
      .then(() => {
        authReloadFollowUp = null;
        return reloadAuthConfiguration();
      });
    return authReloadFollowUp;
  }
  authReloadPromise = (async () => {
    const [pluginRows, connectionRows] = await Promise.all([
      getStoredAuthPluginConfigRows(),
      getIdentityConnectionConfigVersions(),
    ]);
    const nextVersion = Math.max(
      0,
      ...pluginRows.map((row) => row.configVersion),
      ...connectionRows.map((row) => row.configVersion),
    );
    const nextFingerprint = authConfigurationVersion(
      pluginRows,
      connectionRows,
    );
    if (authConfigFingerprint === nextFingerprint) return false;

    const nextAgentProviders = resolveLocalAuthProviders("agent", pluginRows);
    const nextCustomerProviders = effectiveLocalAuthProviders(
      resolveLocalAuthProviders("customer", pluginRows),
    );
    const nextAgentAuth = createAuth("agent", nextAgentProviders);
    const nextPortalAuth = createAuth("customer", nextCustomerProviders);

    // Swap only after both constructions complete so requests cannot observe a
    // mixed generation of host-specific Better Auth configuration.
    auth = nextAgentAuth;
    portalAuth = nextPortalAuth;
    agentLocalAuthProviders = effectiveLocalAuthProviders(nextAgentProviders);
    customerLocalAuthProviders = nextCustomerProviders;
    authConfigVersion = nextVersion;
    authConfigFingerprint = nextFingerprint;
    recordAuthReload("ok", nextVersion);
    return true;
  })();
  try {
    return await authReloadPromise;
  } catch (error) {
    recordAuthReload("failed", Math.max(authConfigVersion, 0));
    throw error;
  } finally {
    authReloadPromise = null;
  }
}

/** Initial load and documented 10-second database fallback for replicas. */
export async function startAuthConfigRuntime(): Promise<void> {
  await reloadAuthConfiguration();
  if (authConfigPoller) return;
  authConfigPoller = setInterval(() => {
    void reloadAuthConfiguration().catch(() => {
      logTaskDesk({
        module: "auth",
        message: "auth.failure",
        level: "error",
        result: "failed",
      });
    });
  }, 10_000);
  authConfigPoller.unref?.();
}

export function stopAuthConfigRuntime(): void {
  if (!authConfigPoller) return;
  clearInterval(authConfigPoller);
  authConfigPoller = null;
}

/** Exact local sign-in paths enabled on the customer Better Auth instance. */
export function isCustomerLocalAuthEndpoint(
  method: string,
  path: string,
  providers: LocalAuthProviders = customerLocalAuthProviders,
): boolean {
  if (
    providers.password &&
    method === "POST" &&
    path === "/api/auth/sign-in/email"
  )
    return true;
  if (
    providers.magicLink &&
    ((method === "POST" && path === "/api/auth/sign-in/magic-link") ||
      (method === "GET" && path === "/api/auth/magic-link/verify"))
  )
    return true;
  return (
    providers.emailOtp &&
    method === "POST" &&
    (path === "/api/auth/sign-in/email-otp" ||
      path === "/api/auth/email-otp/send-verification-otp")
  );
}

/** Public, non-secret methods enabled on the current agent-host auth instance. */
export function agentLocalAuthMethods(): LocalAuthProviders {
  return { ...agentLocalAuthProviders };
}

/** Public, non-secret methods enabled on the current customer-host auth instance. */
export function customerLocalAuthMethods(): LocalAuthProviders {
  return { ...customerLocalAuthProviders };
}

/**
 * The portal's invitation-gated sign-up (CP-12): admitted at the host only while the customer
 * password provider is enabled. The Better Auth hooks then require a live customer invitation
 * credential for the sign-up address, so this does not open general registration.
 */
export function isCustomerInviteSignUpEndpoint(
  method: string,
  path: string,
  providers: LocalAuthProviders = customerLocalAuthProviders,
): boolean {
  return (
    providers.password &&
    method === "POST" &&
    path === "/api/auth/sign-up/email"
  );
}

export function portalForHost(
  host: string | null | undefined,
): AuthPortal | null {
  if (!host) {
    return process.env.NODE_ENV === "test" &&
      new URL(agentOrigin).hostname === "localhost"
      ? "agent"
      : null;
  }
  const normalized = host.toLowerCase();
  for (const [portal, origin] of [
    ["agent", agentOrigin],
    ["customer", customerOrigin],
  ] as const) {
    try {
      if (new URL(origin).host.toLowerCase() === normalized) {
        return portal;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function authForHost(host: string | null | undefined) {
  const portal = portalForHost(host);
  if (!portal) return null;
  return portal === "agent" ? auth : portalAuth;
}
