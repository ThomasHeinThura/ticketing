import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootMocks = vi.hoisted(() => ({
  checkCandidateBootPrerequisites: vi.fn(),
  findCandidateSignInUserByEmail: vi.fn(),
  findCandidateSignInUserById: vi.fn(),
  findVerifiedTwoFactorByUserId: vi.fn(),
  findActiveTwoFactorChallenge: vi.fn(),
  assertNoMigrationUrlInApiProcess: vi.fn(),
  assertApplicationRoleIsNotPrivileged: vi.fn(),
  migrateColumns: vi.fn(),
  startAuthConfigRuntime: vi.fn(),
  stopAuthConfigRuntime: vi.fn(),
  seedDefaultWorkspaceRoles: vi.fn(),
  seedCanonicalWorkspaceRoles: vi.fn(),
  seedInternalOrganisationAndStaffPersons: vi.fn(),
  reconcileWorkspaceAdminReach: vi.fn(),
  backfillWorkspaceAndProjectDefaults: vi.fn(),
  recoverDensePositionPartitions: vi.fn(),
  ensureSetupToken: vi.fn(),
  initializePlugins: vi.fn(),
  purgeExpiredCustomerInvitationEnvelopes: vi.fn(),
  initializeWebSocketAdapter: vi.fn(),
  startInboxRealtimeListener: vi.fn(),
  startObservabilityRuntime: vi.fn(),
  stopObservabilityRuntime: vi.fn(),
  getInvitationDetails: vi.fn(),
  writeUploadedObject: vi.fn(),
  finishImpersonation: vi.fn(),
  impersonatorStillEligible: vi.fn(),
  appendAuditLog: vi.fn(),
}));

vi.mock("../../apps/api/src/candidate-read-only.repository", () => ({
  checkCandidateBootPrerequisites: bootMocks.checkCandidateBootPrerequisites,
  findCandidateSignInUserByEmail: bootMocks.findCandidateSignInUserByEmail,
  findCandidateSignInUserById: bootMocks.findCandidateSignInUserById,
  findVerifiedTwoFactorByUserId: bootMocks.findVerifiedTwoFactorByUserId,
  findActiveTwoFactorChallenge: bootMocks.findActiveTwoFactorChallenge,
}));

vi.mock(
  "../../apps/api/src/database/assert-no-migration-url-in-api-process",
  () => ({
    assertNoMigrationUrlInApiProcess:
      bootMocks.assertNoMigrationUrlInApiProcess,
  }),
);

vi.mock(
  "../../apps/api/src/database/assert-application-role-is-not-privileged",
  () => ({
    assertApplicationRoleIsNotPrivileged:
      bootMocks.assertApplicationRoleIsNotPrivileged,
  }),
);

vi.mock("../../apps/api/src/migrations/column-migration", () => ({
  migrateColumns: bootMocks.migrateColumns,
}));

vi.mock("../../apps/api/src/utils/seed-default-workspace-roles", () => ({
  seedDefaultWorkspaceRoles: bootMocks.seedDefaultWorkspaceRoles,
  seedCanonicalWorkspaceRoles: bootMocks.seedCanonicalWorkspaceRoles,
}));

vi.mock("../../apps/api/src/utils/seed-internal-organisation", () => ({
  seedInternalOrganisationAndStaffPersons:
    bootMocks.seedInternalOrganisationAndStaffPersons,
  ensureStaffPersonForUser: vi.fn(),
  ensureInternalOrganisation: vi.fn(),
}));

vi.mock("../../apps/api/src/workspace/workspace-admin-reach", () => ({
  reconcileWorkspaceAdminReach: bootMocks.reconcileWorkspaceAdminReach,
}));

vi.mock("../../apps/api/src/utils/backfill-workspace-project-defaults", () => ({
  backfillWorkspaceAndProjectDefaults:
    bootMocks.backfillWorkspaceAndProjectDefaults,
}));

vi.mock("../../apps/api/src/scheduler/position-rebalance", () => ({
  recoverDensePositionPartitions: bootMocks.recoverDensePositionPartitions,
}));

vi.mock("../../apps/api/src/instance/setup-token", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/instance/setup-token")
    >();
  return {
    ...actual,
    ensureSetupToken: bootMocks.ensureSetupToken,
  };
});

vi.mock("../../apps/api/src/plugins", () => ({
  initializePlugins: bootMocks.initializePlugins,
}));

vi.mock(
  "../../apps/api/src/customer-invitation/delivery/repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/customer-invitation/delivery/repository")
      >();
    return {
      ...actual,
      purgeExpiredCustomerInvitationEnvelopes:
        bootMocks.purgeExpiredCustomerInvitationEnvelopes,
    };
  },
);

vi.mock("../../apps/api/src/ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../apps/api/src/ws")>();
  return {
    ...actual,
    initializeWebSocketAdapter: bootMocks.initializeWebSocketAdapter,
    startInboxRealtimeListener: bootMocks.startInboxRealtimeListener,
  };
});

vi.mock(
  "../../apps/api/src/instance/observability/runtime",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/instance/observability/runtime")
      >();
    return {
      ...actual,
      startObservabilityRuntime: bootMocks.startObservabilityRuntime,
      stopObservabilityRuntime: bootMocks.stopObservabilityRuntime,
    };
  },
);

vi.mock("../../apps/api/src/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/auth")>();
  return {
    ...actual,
    startAuthConfigRuntime: bootMocks.startAuthConfigRuntime,
    stopAuthConfigRuntime: bootMocks.stopAuthConfigRuntime,
  };
});

vi.mock(
  "../../apps/api/src/invitation/controllers/get-invitation-details",
  () => ({
    default: bootMocks.getInvitationDetails,
  }),
);

vi.mock("../../apps/api/src/instance/impersonation/finish", () => ({
  finishImpersonation: bootMocks.finishImpersonation,
}));

vi.mock("../../apps/api/src/instance/impersonation/eligibility", () => ({
  impersonatorStillEligible: bootMocks.impersonatorStillEligible,
}));

vi.mock("../../apps/api/src/audit/audit-writer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../apps/api/src/audit/audit-writer")
    >();
  return {
    ...actual,
    appendAuditLog: bootMocks.appendAuditLog,
  };
});

import type { Context } from "hono";
import {
  authForHost,
  effectiveLocalAuthProviders,
} from "../../apps/api/src/auth";
import { auditPortalSignInRefusal } from "../../apps/api/src/auth/portal-sign-in-refusal";
import {
  assertCandidateReadOnlyAuthActionAllowed,
  assertCandidateServingBootPrerequisites,
  CANDIDATE_ALLOWED_API_GET_ROUTE_KEYS,
  CANDIDATE_DENIED_GET_ROUTE_KEYS,
  CANDIDATE_READ_ONLY_ERROR_CODE,
  evaluateCandidateAuthPostBody,
  evaluateCandidateReadOnlyRequest,
  isCandidateReadOnlyActive,
} from "../../apps/api/src/candidate-read-only";
import {
  createApp,
  runApiBootTasks,
  runMigrationStep,
} from "../../apps/api/src/index";
import { enforceImpersonationRestrictions } from "../../apps/api/src/instance/impersonation/guard";
import { createCredentialAwareDrizzleAdapter } from "../../apps/api/src/pending-action/credential-invalidation";
import { runNextWithPolicyShadow } from "../../apps/api/src/permissions/shadow-middleware";
import {
  initializeScheduler,
  registeredJobCatalog,
  shutdownScheduler,
} from "../../apps/api/src/scheduler";
import getSettings from "../../apps/api/src/utils/get-settings";

const originalRole = process.env.TASKDESK_ROLE;
const originalCandidateReadOnly = process.env.TASKDESK_CANDIDATE_READ_ONLY;
const originalPolicyShadow = process.env.TASKDESK_POLICY_SHADOW;

const ORIGIN = new URL(
  process.env.TASKDESK_AGENT_URL || "http://localhost:5173",
).origin;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TASKDESK_ROLE;
  delete process.env.TASKDESK_CANDIDATE_READ_ONLY;
  delete process.env.TASKDESK_POLICY_SHADOW;
  bootMocks.checkCandidateBootPrerequisites.mockResolvedValue({
    hasUserTable: true,
    hasSessionTable: true,
    hasVerificationTable: true,
    hasTwoFactorTable: true,
    hasWorkspaceTable: true,
    hasWorkspaceRoleTable: true,
    hasInternalOrganisation: true,
    hasCanonicalWorkspaceRoles: true,
    hasActiveWorkspaceFixture: true,
    hasActiveImpersonationSessions: false,
  });
  bootMocks.recoverDensePositionPartitions.mockResolvedValue([]);
});

afterEach(() => {
  shutdownScheduler();
  if (originalRole === undefined) {
    delete process.env.TASKDESK_ROLE;
  } else {
    process.env.TASKDESK_ROLE = originalRole;
  }
  if (originalCandidateReadOnly === undefined) {
    delete process.env.TASKDESK_CANDIDATE_READ_ONLY;
  } else {
    process.env.TASKDESK_CANDIDATE_READ_ONLY = originalCandidateReadOnly;
  }
  if (originalPolicyShadow === undefined) {
    delete process.env.TASKDESK_POLICY_SHADOW;
  } else {
    process.env.TASKDESK_POLICY_SHADOW = originalPolicyShadow;
  }
});

describe("candidate read-only request gate", () => {
  it("keeps ordinary request handling unchanged when candidate mode is inactive", () => {
    expect(isCandidateReadOnlyActive()).toBe(false);
    const decision = evaluateCandidateReadOnlyRequest({
      method: "POST",
      pathname: "/api/workspace",
      headers: new Headers({
        authorization: "Bearer tdk_pat_123",
      }),
    });
    expect(decision).toEqual({
      allowed: true,
      reason: "candidate_mode_inactive",
    });
  });

  it("allows only password sign-in and existing-challenge TOTP verification POSTs with empty query strings in candidate mode", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/sign-in/email",
        headers: new Headers({ origin: ORIGIN }),
      }),
    ).toEqual({
      allowed: true,
      reason: "allowed_password_sign_in",
    });

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/two-factor/verify-totp",
        headers: new Headers({
          origin: ORIGIN,
          cookie: "two_factor=2fa-challenge-id.sig",
        }),
      }),
    ).toEqual({
      allowed: true,
      reason: "allowed_existing_totp_verify",
    });

    // Rejects query strings on allowed POST paths
    expect(
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/sign-in/email",
        search: "?extra=1",
        headers: new Headers({ origin: ORIGIN }),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "invalid_query_parameters",
    });
  });

  it("rejects TOTP enrollment verification and missing-challenge TOTP verification at the HTTP gate", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    // Missing two_factor challenge cookie
    expect(
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/two-factor/verify-totp",
        headers: new Headers({ origin: ORIGIN }),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "totp_enrollment_verify_forbidden",
    });

    // Logged-in session cookie present alongside two_factor cookie (enrollment verification)
    for (const sessionCookie of [
      "__Host-tdk_agent_session=tok",
      "__Host-tdk_portal_session=tok",
      "better-auth.session_token=tok",
      "session_token=tok",
    ]) {
      expect(
        evaluateCandidateReadOnlyRequest({
          method: "POST",
          pathname: "/api/auth/two-factor/verify-totp",
          headers: new Headers({
            origin: ORIGIN,
            cookie: `${sessionCookie}; two_factor=2fa-challenge-id`,
          }),
        }),
      ).toEqual({
        allowed: false,
        status: 403,
        reason: "totp_enrollment_verify_forbidden",
      });
    }
  });

  it("rejects factor enrollment, backup-code, OTP, magic-link, SSO, invitation, business mutation, upload, job trigger, and HEAD routes", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    const deniedMutations: Array<[string, string]> = [
      ["POST", "/api/auth/two-factor/enable"],
      ["POST", "/api/auth/two-factor/disable"],
      ["POST", "/api/auth/two-factor/get-totp-uri"],
      ["POST", "/api/auth/two-factor/generate-backup-codes"],
      ["POST", "/api/auth/two-factor/verify-backup-code"],
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/sign-in/email-otp"],
      ["POST", "/api/auth/email-otp/send-verification-otp"],
      ["POST", "/api/auth/sign-in/magic-link"],
      ["POST", "/api/auth/sign-in/social"],
      ["POST", "/api/auth/change-password"],
      ["POST", "/api/workspace"],
      ["POST", "/api/workspace/ws_123/activate"],
      ["POST", "/api/workspaces/ws_123/terminology/preview"],
      ["PATCH", "/api/me/settings"],
      ["POST", "/api/task/ws_123"],
      ["PUT", "/api/storage/filesystem-upload"],
      ["PUT", "/api/storage/filesystem-attachment-upload"],
      ["POST", "/api/instance/jobs/outbox-drain/run"],
      ["DELETE", "/api/task/tsk_123"],
      ["PATCH", "/api/work-items/WI-1"],
      ["HEAD", "/api/public/health/live"],
      ["HEAD", "/api/config"],
      ["HEAD", "/auth/sign-in"],
    ];

    for (const [method, pathname] of deniedMutations) {
      const decision = evaluateCandidateReadOnlyRequest({
        method,
        pathname,
        headers: new Headers(),
      });
      expect(decision, `${method} ${pathname}`).toEqual({
        allowed: false,
        status: 403,
        reason: "method_not_allowed",
      });
    }
  });

  it("rejects API-key/Bearer headers, WebSocket upgrades, SCIM routes, unknown GETs, effectful GETs, and non-allowlisted GETs", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "GET",
        pathname: "/api/auth/get-session",
        headers: new Headers({ authorization: "Bearer tdk_pat_secret" }),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "api_key_or_bearer_forbidden",
    });

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/sign-in/email",
        headers: new Headers({ "x-api-key": "tdk_pat_secret" }),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "api_key_or_bearer_forbidden",
    });

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "GET",
        pathname: "/api/ws",
        headers: new Headers({ upgrade: "websocket" }),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "websocket_upgrade_forbidden",
    });

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "GET",
        pathname: "/scim/v2/Users",
        headers: new Headers(),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "unregistered_route_forbidden",
    });

    expect(
      evaluateCandidateReadOnlyRequest({
        method: "GET",
        pathname: "/api/unregistered-route",
        headers: new Headers(),
      }),
    ).toEqual({
      allowed: false,
      status: 403,
      reason: "unregistered_route_forbidden",
    });

    const sampleEffectfulGets = [
      "/api/auth/identity/conn_123/start",
      "/api/auth/identity/conn_123/callback",
      "/api/auth/magic-link/verify",
      "/api/auth/device",
      "/api/portal/sign-in/home-realm/start",
      "/api/oauth/id-token",
      "/api/me/identity-links/intents/int_123",
      "/api/invitation/public/inv_123",
      "/api/invitation/pending",
      "/api/portal/invitations/inv_123/continuation-result",
      "/api/notification-preferences/email-link-handoff",
      "/api/portal/notification-preferences/email-link-handoff",
      "/api/task/export/prj_123",
      "/api/portal/requests/export.csv",
      "/api/report-exports",
      "/api/report-exports/exp_123/download",
      "/api/imports/imp_123/dry-run-all",
      "/api/attachments/att_123",
      "/api/attachments/att_123/preview",
      "/api/storage/filesystem-download",
      "/api/storage/portal-download",
      "/api/instance/audit",
      "/api/workspaces/ws_123/audit",
      "/api/audit/entity/task/tsk_123",
      "/api/work-items/WI-1/reconstruct",
    ];

    for (const pathname of sampleEffectfulGets) {
      expect(
        evaluateCandidateReadOnlyRequest({
          method: "GET",
          pathname,
          headers: new Headers(),
        }),
        `GET ${pathname}`,
      ).toEqual({
        allowed: false,
        status: 403,
        reason: "effectful_get_route_forbidden",
      });
    }

    // Registered GETs outside the positive A8-3 allowlist (dashboards, reports, KB, notifications, portal-data) are denied fail-closed
    const nonAllowlistedGets = [
      "/api/dashboards",
      "/api/dashboards/dsh_123",
      "/api/reports/definitions",
      "/api/notification",
      "/api/kb/articles",
      "/api/portal/requests",
      "/api/task/tsk_123",
      "/dashboard",
      "/login",
      "/assets/unhashed.js",
    ];

    for (const pathname of nonAllowlistedGets) {
      expect(
        evaluateCandidateReadOnlyRequest({
          method: "GET",
          pathname,
          headers: new Headers(),
        }),
        `GET ${pathname}`,
      ).toEqual({
        allowed: false,
        status: 403,
        reason: "non_allowlisted_get_route_forbidden",
      });
    }

    expect(CANDIDATE_DENIED_GET_ROUTE_KEYS.size).toBeGreaterThanOrEqual(29);
    expect(CANDIDATE_ALLOWED_API_GET_ROUTE_KEYS.size).toBe(20);
  });

  it("allows only the positive A8-3 API GET routes, declared HTML navigation routes, and signed build static assets with strict query validation", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    const allowedRequests: Array<{
      pathname: string;
      search?: string;
      approvedWorkspaceId?: string;
      approvedRequestTypeId?: string;
      approvedLocale?: string;
    }> = [
      { pathname: "/api/health" },
      { pathname: "/api/public/health/live" },
      { pathname: "/api/public/health/ready" },
      { pathname: "/api/config" },
      { pathname: "/api/auth/get-session" },
      { pathname: "/api/auth/get-session", search: "?disableCookieCache=true" },
      { pathname: "/api/auth/get-session", search: "?disableRefresh=true" },
      {
        pathname: "/api/public/terminology",
        search: "?locale=en-US",
        approvedLocale: "en-US",
      },
      { pathname: "/api/me/security/factors" },
      { pathname: "/api/me/csrf-token" },
      { pathname: "/api/me/settings" },
      { pathname: "/api/workspace" },
      {
        pathname: "/api/workspace/ws_approved/members",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/capabilities",
        search: "?workspaceId=ws_approved",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/workspaces/ws_approved/features/resolved",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/workspaces/ws_approved/terminology/runtime",
        search: "?locale=de-DE",
        approvedWorkspaceId: "ws_approved",
        approvedLocale: "de-DE",
      },
      {
        pathname: "/api/request-types",
        search: "?workspaceId=ws_approved",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/request-type-groups/order",
        search: "?workspaceId=ws_approved",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/workspace/ws_approved/work-item-types",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/custom-fields",
        search: "?workspaceId=ws_approved",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/workspaces/ws_approved/terminology",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/request-types/rt_approved",
        approvedRequestTypeId: "rt_approved",
      },
      // Declared HTML navigation paths
      { pathname: "/auth/sign-in" },
      {
        pathname: "/auth/sign-in",
        search: "?redirect=%2Fdashboard%2Fsettings%2Fworkspace%2Frequest-types",
      },
      { pathname: "/auth/two-factor" },
      { pathname: "/dashboard/settings/workspace/request-types" },
      {
        pathname: "/dashboard/settings/workspace/request-types",
        search: "?requestTypeId=rt_approved",
        approvedRequestTypeId: "rt_approved",
      },
      { pathname: "/dashboard/settings/workspace/terminology" },
      // Signed build static assets
      { pathname: "/assets/index-1a2b3c4d.js" },
      { pathname: "/assets/vendor/chunk-A1B2C3D4.css" },
      { pathname: "/favicon.ico" },
      { pathname: "/favicon.svg" },
      { pathname: "/site.webmanifest" },
    ];

    for (const req of allowedRequests) {
      expect(
        evaluateCandidateReadOnlyRequest({
          method: "GET",
          ...req,
          headers: new Headers(),
        }),
        `GET ${req.pathname}${req.search ?? ""}`,
      ).toEqual({
        allowed: true,
        reason: "allowed_read_only_route",
      });
    }

    // Rejects unknown keys, duplicate keys, missing required query params, alternate IDs/locales, and query strings on static assets
    const invalidQueryRequests: Array<{
      pathname: string;
      search?: string;
      approvedWorkspaceId?: string;
      approvedRequestTypeId?: string;
      approvedLocale?: string;
    }> = [
      { pathname: "/api/config", search: "?foo=bar" },
      {
        pathname: "/api/auth/get-session",
        search: "?disableCookieCache=false",
      },
      { pathname: "/api/public/terminology" },
      { pathname: "/api/public/terminology", search: "?locale=xx-YY" },
      {
        pathname: "/api/public/terminology",
        search: "?locale=en-US&locale=de-DE",
      },
      {
        pathname: "/api/public/terminology",
        search: "?locale=de-DE",
        approvedLocale: "en-US",
      },
      { pathname: "/api/request-types" },
      {
        pathname: "/api/request-types",
        search: "?workspaceId=ws_other",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/request-types",
        search: "?workspaceId=ws_approved&extra=1",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/workspaces/ws_other/terminology",
        approvedWorkspaceId: "ws_approved",
      },
      {
        pathname: "/api/request-types/rt_other",
        approvedRequestTypeId: "rt_approved",
      },
      { pathname: "/auth/sign-in", search: "?redirect=%2Fdashboard" },
      { pathname: "/assets/index-1a2b3c4d.js", search: "?v=2" },
    ];

    for (const req of invalidQueryRequests) {
      expect(
        evaluateCandidateReadOnlyRequest({
          method: "GET",
          ...req,
          headers: new Headers(),
        }),
        `GET ${req.pathname}${req.search ?? ""}`,
      ).toEqual({
        allowed: false,
        status: 403,
        reason: "invalid_query_parameters",
      });
    }
  });

  it("blocks denied routes at the Hono app boundary before downstream handlers run", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    const { app } = createApp();
    const agentHost = { Host: "localhost:5173" };

    const inviteRes = await app.request(
      "http://localhost:5173/api/invitation/public/inv_123",
      {
        method: "GET",
        headers: agentHost,
      },
    );
    expect(inviteRes.status).toBe(403);
    await expect(inviteRes.json()).resolves.toMatchObject({
      code: CANDIDATE_READ_ONLY_ERROR_CODE,
      reason: "effectful_get_route_forbidden",
    });
    expect(bootMocks.getInvitationDetails).not.toHaveBeenCalled();

    const dashboardRes = await app.request(
      "http://localhost:5173/api/dashboards",
      {
        method: "GET",
        headers: agentHost,
      },
    );
    expect(dashboardRes.status).toBe(403);
    await expect(dashboardRes.json()).resolves.toMatchObject({
      code: CANDIDATE_READ_ONLY_ERROR_CODE,
      reason: "non_allowlisted_get_route_forbidden",
    });

    const enrollRes = await app.request(
      "http://localhost:5173/api/auth/two-factor/enable",
      {
        method: "POST",
        headers: {
          ...agentHost,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "secret" }),
      },
    );
    expect(enrollRes.status).toBe(403);
    await expect(enrollRes.json()).resolves.toMatchObject({
      code: CANDIDATE_READ_ONLY_ERROR_CODE,
      reason: "method_not_allowed",
    });

    const bearerRes = await app.request(
      "http://localhost:5173/api/auth/get-session",
      {
        method: "GET",
        headers: {
          ...agentHost,
          Authorization: "Bearer tdk_pat_123",
        },
      },
    );
    expect(bearerRes.status).toBe(403);
    await expect(bearerRes.json()).resolves.toMatchObject({
      code: CANDIDATE_READ_ONLY_ERROR_CODE,
      reason: "api_key_or_bearer_forbidden",
    });
  });
});

describe("candidate read-only auth, impersonation, and policy-shadow write isolation", () => {
  it("allows password sign-in only for non-banned staff users with active workspace membership and valid factor state", async () => {
    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      id: "usr_1",
      twoFactorEnabled: false,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: true,
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        body: { email: "staff@example.com", password: "secret" },
      }),
    ).resolves.toEqual({ allowed: true });

    // Customer portal auth is refused before session creation
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "customer",
        body: { email: "staff@example.com", password: "secret" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "customer_portal_auth_forbidden",
    });

    // Customer-side person on agent portal is refused before Better Auth creates a session or writes audit log
    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      id: "usr_cust",
      twoFactorEnabled: false,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: true,
      hasActiveWorkspaceMembership: true,
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        body: { email: "customer@example.com", password: "secret" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "wrong_portal_user_forbidden",
    });

    // User with expired ban metadata is refused before Better Auth admin plugin clears ban fields on user table
    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      id: "usr_expired_ban",
      twoFactorEnabled: false,
      banned: true,
      banReason: "temp",
      banExpires: new Date(Date.now() - 60_000),
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: true,
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        body: { email: "banned@example.com", password: "secret" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "banned_or_expired_ban_user_forbidden",
    });

    // User without active workspace membership is refused
    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      id: "usr_no_ws",
      twoFactorEnabled: false,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: false,
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        body: { email: "nows@example.com", password: "secret" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "missing_active_workspace_membership_forbidden",
    });

    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      id: "usr_3",
      twoFactorEnabled: true,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: true,
    });
    bootMocks.findVerifiedTwoFactorByUserId.mockResolvedValueOnce(undefined);
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        body: { email: "half-enrolled@example.com", password: "secret" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "incomplete_totp_enrollment_forbidden",
    });
  });

  it("allows /two-factor/verify-totp only for an active sign-in challenge of an already-enrolled, non-banned staff user", async () => {
    const future = new Date(Date.now() + 300_000);
    bootMocks.findActiveTwoFactorChallenge.mockResolvedValueOnce({
      id: "ver_1",
      identifier: "2fa-challenge-1",
      value: "usr_totp",
      expiresAt: future,
    });
    bootMocks.findCandidateSignInUserById.mockResolvedValueOnce({
      id: "usr_totp",
      twoFactorEnabled: true,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: true,
    });
    bootMocks.findVerifiedTwoFactorByUserId.mockResolvedValueOnce({
      id: "tf_totp",
      userId: "usr_totp",
      verified: true,
    });

    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/two-factor/verify-totp",
        body: { code: "123456" },
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: "two_factor=2fa-challenge-1.sig" }),
        twoFactorCookieValue: "2fa-challenge-1.sig",
      }),
    ).resolves.toEqual({ allowed: true });

    // Rejects when an existing session is present (enrollment verification)
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/two-factor/verify-totp",
        body: { code: "123456" },
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: "two_factor=2fa-challenge-1.sig" }),
        existingSessionUserId: "usr_totp",
        twoFactorCookieValue: "2fa-challenge-1.sig",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "totp_enrollment_verify_forbidden",
    });

    // Rejects when challenge row does not exist
    bootMocks.findActiveTwoFactorChallenge.mockResolvedValue(undefined);
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/two-factor/verify-totp",
        body: { code: "123456" },
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: "two_factor=2fa-missing" }),
        twoFactorCookieValue: "2fa-missing",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "missing_active_two_factor_challenge",
    });

    // Rejects when user is not already TOTP-enrolled (e.g. unverified factor row)
    bootMocks.findActiveTwoFactorChallenge.mockResolvedValueOnce({
      id: "ver_2",
      identifier: "2fa-challenge-2",
      value: "usr_unenrolled",
      expiresAt: future,
    });
    bootMocks.findCandidateSignInUserById.mockResolvedValueOnce({
      id: "usr_unenrolled",
      twoFactorEnabled: false,
      banned: false,
      banReason: null,
      banExpires: null,
      isCustomerSidePerson: false,
      hasActiveWorkspaceMembership: true,
    });
    bootMocks.findVerifiedTwoFactorByUserId.mockResolvedValueOnce(undefined);
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/two-factor/verify-totp",
        body: { code: "123456" },
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: "two_factor=2fa-challenge-2" }),
        twoFactorCookieValue: "2fa-challenge-2",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "totp_not_already_enrolled",
    });
  });

  it("suppresses portal sign-in refusal audit writes, impersonation finish writes, and policy-shadow evaluations in candidate mode", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    await auditPortalSignInRefusal("usr_1", "customer_on_agent_host");
    expect(bootMocks.appendAuditLog).not.toHaveBeenCalled();

    const fakeContext = {
      get: (key: string) => {
        if (key === "session") {
          return {
            id: "sess_imp",
            userId: "usr_target",
            impersonatedBy: "usr_admin",
            createdAt: new Date(Date.now() - 3_600_000),
          };
        }
        return undefined;
      },
    } as unknown as Context;

    await expect(enforceImpersonationRestrictions(fakeContext)).rejects.toThrow(
      "impersonation is not allowed in candidate read-only mode",
    );
    expect(bootMocks.finishImpersonation).not.toHaveBeenCalled();

    let nextCalled = false;
    await runNextWithPolicyShadow(fakeContext, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("prevents Better Auth user updates, bulk verification cleanup, and session refresh/expiry deletion in candidate mode", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    const adapterFactory = createCredentialAwareDrizzleAdapter();
    const adapter = adapterFactory({} as never);

    await expect(
      adapter.update({
        model: "user",
        where: [{ field: "id", value: "usr_1" }],
        update: { banned: false, banExpires: null, banReason: null },
      }),
    ).rejects.toThrow(
      "Candidate read-only mode forbids Better Auth user row updates",
    );

    await expect(
      adapter.deleteMany({
        model: "verification",
        where: [{ field: "expiresAt", value: new Date(), operator: "lt" }],
      }),
    ).resolves.toBe(0);

    const agentAuth = authForHost("localhost:5173");
    expect(agentAuth).not.toBeNull();
    const sessionRes = await agentAuth!.handler(
      new Request("http://localhost:5173/api/auth/get-session", {
        method: "GET",
        headers: { Host: "localhost:5173" },
      }),
    );
    expect(sessionRes.status).toBe(200);
    expect(agentAuth!.options.session?.deferSessionRefresh).toBe(true);
    expect(agentAuth!.options.session?.disableSessionRefresh).toBe(true);
    expect(agentAuth!.options.verification?.disableCleanup).toBe(true);
  });

  it("reports registration, email OTP, SSO, and workspace creation as disabled in getSettings during candidate mode", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csec";

    try {
      const settings = await getSettings();
      expect(settings.disableRegistration).toBe(true);
      expect(settings.disablePasswordRegistration).toBe(true);
      expect(settings.disableEmailOtpSignIn).toBe(true);
      expect(settings.disableWorkspaceCreation).toBe(true);
      expect(settings.hasGithubSignIn).toBe(false);
      expect(settings.hasGoogleSignIn).toBe(false);
      expect(settings.hasDiscordSignIn).toBe(false);
      expect(settings.hasCustomOAuth).toBe(false);
      expect(settings.customOAuthAutoLogin).toBe(false);
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });
});

describe("candidate read-only boot and scheduler isolation", () => {
  it("skips all serving-boot seed, repair, purge, scheduler, plugin, and realtime tasks when candidate read-only mode is active", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    await runApiBootTasks({ role: "web" });

    expect(bootMocks.assertNoMigrationUrlInApiProcess).toHaveBeenCalledTimes(1);
    expect(
      bootMocks.assertApplicationRoleIsNotPrivileged,
    ).toHaveBeenCalledTimes(1);
    expect(bootMocks.checkCandidateBootPrerequisites).toHaveBeenCalledTimes(1);
    expect(bootMocks.startAuthConfigRuntime).toHaveBeenCalledWith({
      poll: false,
    });
    expect(bootMocks.startObservabilityRuntime).toHaveBeenCalledWith({
      metricsListener: true,
      poll: false,
    });

    // None of the serving-boot DML/seed/repair/purge/plugin/realtime steps may run
    expect(bootMocks.migrateColumns).not.toHaveBeenCalled();
    expect(bootMocks.seedDefaultWorkspaceRoles).not.toHaveBeenCalled();
    expect(bootMocks.seedCanonicalWorkspaceRoles).not.toHaveBeenCalled();
    expect(
      bootMocks.seedInternalOrganisationAndStaffPersons,
    ).not.toHaveBeenCalled();
    expect(bootMocks.reconcileWorkspaceAdminReach).not.toHaveBeenCalled();
    expect(
      bootMocks.backfillWorkspaceAndProjectDefaults,
    ).not.toHaveBeenCalled();
    expect(bootMocks.recoverDensePositionPartitions).not.toHaveBeenCalled();
    expect(bootMocks.ensureSetupToken).not.toHaveBeenCalled();
    expect(bootMocks.initializePlugins).not.toHaveBeenCalled();
    expect(
      bootMocks.purgeExpiredCustomerInvitationEnvelopes,
    ).not.toHaveBeenCalled();
    expect(bootMocks.initializeWebSocketAdapter).not.toHaveBeenCalled();
    expect(bootMocks.startInboxRealtimeListener).not.toHaveBeenCalled();
  });

  it("fails closed on boot when copied database prerequisites are missing or active impersonation sessions exist", async () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";
    bootMocks.checkCandidateBootPrerequisites.mockResolvedValueOnce({
      hasUserTable: true,
      hasSessionTable: true,
      hasVerificationTable: true,
      hasTwoFactorTable: false,
      hasWorkspaceTable: true,
      hasWorkspaceRoleTable: true,
      hasInternalOrganisation: false,
      hasCanonicalWorkspaceRoles: true,
      hasActiveWorkspaceFixture: false,
      hasActiveImpersonationSessions: true,
    });

    await expect(assertCandidateServingBootPrerequisites()).rejects.toThrow(
      "Candidate read-only serving boot prerequisites missing (two_factor table, seeded internal organisation, active workspace membership fixture, no active impersonation sessions)",
    );

    bootMocks.checkCandidateBootPrerequisites.mockResolvedValueOnce({
      hasUserTable: true,
      hasSessionTable: true,
      hasVerificationTable: true,
      hasTwoFactorTable: true,
      hasWorkspaceTable: true,
      hasWorkspaceRoleTable: true,
      hasInternalOrganisation: true,
      hasCanonicalWorkspaceRoles: false,
      hasActiveWorkspaceFixture: true,
      hasActiveImpersonationSessions: false,
    });

    await expect(runApiBootTasks({ role: "web" })).rejects.toThrow(
      "Candidate read-only serving boot prerequisites missing (seeded workspace_role rows)",
    );
    expect(bootMocks.startAuthConfigRuntime).not.toHaveBeenCalled();
    expect(bootMocks.startObservabilityRuntime).not.toHaveBeenCalled();
  });

  it("fails closed when TASKDESK_CANDIDATE_READ_ONLY is set on migrate, jobs, or all roles, or when TASKDESK_POLICY_SHADOW is enabled", async () => {
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    await expect(runApiBootTasks({ role: "all" })).rejects.toThrow(
      "TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_ROLE=web",
    );
    await expect(runApiBootTasks({ role: "jobs" })).rejects.toThrow(
      "TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_ROLE=web",
    );
    await expect(runMigrationStep()).rejects.toThrow(
      "TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_ROLE=web",
    );
    expect(() => initializeScheduler("all")).toThrow(
      "TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_ROLE=web",
    );

    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_POLICY_SHADOW = "sample";
    await expect(runApiBootTasks({ role: "web" })).rejects.toThrow(
      "TASKDESK_CANDIDATE_READ_ONLY requires TASKDESK_POLICY_SHADOW to be unset or off",
    );
  });

  it("does not start any scheduler cron job or poller when initializeScheduler(web) is called in candidate mode", () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";

    initializeScheduler("web");
    const activeJobs = registeredJobCatalog().filter(
      (job) => job.nextRunAt !== null,
    );
    expect(activeJobs).toEqual([]);
  });

  it("preserves normal web boot tasks when TASKDESK_CANDIDATE_READ_ONLY is absent", async () => {
    process.env.TASKDESK_ROLE = "web";

    await runApiBootTasks({ role: "web" });

    expect(bootMocks.checkCandidateBootPrerequisites).not.toHaveBeenCalled();
    expect(bootMocks.migrateColumns).toHaveBeenCalledTimes(1);
    expect(bootMocks.startAuthConfigRuntime).toHaveBeenCalledWith();
    expect(bootMocks.seedDefaultWorkspaceRoles).toHaveBeenCalledTimes(1);
    expect(bootMocks.seedCanonicalWorkspaceRoles).toHaveBeenCalledTimes(1);
    expect(
      bootMocks.seedInternalOrganisationAndStaffPersons,
    ).toHaveBeenCalledTimes(1);
    expect(bootMocks.reconcileWorkspaceAdminReach).toHaveBeenCalledTimes(1);
    expect(bootMocks.backfillWorkspaceAndProjectDefaults).toHaveBeenCalledTimes(
      1,
    );
    expect(bootMocks.ensureSetupToken).toHaveBeenCalledTimes(1);
    expect(bootMocks.initializePlugins).toHaveBeenCalledTimes(1);
    expect(
      bootMocks.purgeExpiredCustomerInvitationEnvelopes,
    ).toHaveBeenCalledTimes(1);
    expect(bootMocks.initializeWebSocketAdapter).toHaveBeenCalledTimes(1);
    expect(bootMocks.startInboxRealtimeListener).toHaveBeenCalledTimes(1);
    expect(bootMocks.startObservabilityRuntime).toHaveBeenCalledWith({
      metricsListener: true,
    });
  });
});

describe("candidate read-only trust-device, sign-out, and provider masking", () => {
  const candidate = () => {
    process.env.TASKDESK_ROLE = "web";
    process.env.TASKDESK_CANDIDATE_READ_ONLY = "1";
  };
  const session = "better-auth.session_token=tok";

  it("rejects trust_device cookies on sign-in and verify-totp at the HTTP gate and auth hook", async () => {
    candidate();
    for (const name of [
      "better-auth.trust_device",
      "__Secure-better-auth.trust_device",
      "trust_device",
      "x.trust-device",
    ]) {
      for (const pathname of [
        "/api/auth/sign-in/email",
        "/api/auth/two-factor/verify-totp",
      ]) {
        expect(
          evaluateCandidateReadOnlyRequest({
            method: "POST",
            pathname,
            headers: new Headers({
              origin: ORIGIN,
              cookie: `${name}=v; two_factor=c`,
            }),
          }),
          `${name} ${pathname}`,
        ).toMatchObject({
          allowed: false,
          reason: "trust_device_cookie_forbidden",
        });
      }
      await expect(
        assertCandidateReadOnlyAuthActionAllowed({
          path: "/sign-in/email",
          method: "POST",
          portal: "agent",
          headers: new Headers({ cookie: `${name}=v` }),
          body: { email: "a@b.c", password: "x" },
        }),
      ).resolves.toEqual({
        allowed: false,
        reason: "trust_device_cookie_forbidden",
      });
    }
  });

  it("allows only code with absent or false trustDevice on verify-totp (HTTP gate body)", async () => {
    candidate();
    const post = (body: string, type = "application/json") =>
      new Request("http://localhost:5173/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "content-type": type },
        body,
      });
    for (const ok of [
      '{"code":"123456"}',
      '{"code":"123456","trustDevice":false}',
    ]) {
      const request = post(ok);
      await expect(
        evaluateCandidateAuthPostBody({
          pathname: "/api/auth/two-factor/verify-totp",
          request,
        }),
      ).resolves.toMatchObject({ allowed: true });
      // The original request body must stay readable for Better Auth.
      await expect(request.json()).resolves.toBeTruthy();
    }
    for (const bad of [
      '{"code":"123456","trustDevice":true}',
      '{"code":"123456","trustDevice":"false"}',
      '{"code":"123456","rememberMe":true}',
      '{"code":"  "}',
      '{"trustDevice":false}',
      '{"code":123456}',
      "[]",
      "null",
      "not json",
    ]) {
      await expect(
        evaluateCandidateAuthPostBody({
          pathname: "/api/auth/two-factor/verify-totp",
          request: post(bad),
        }),
        bad,
      ).resolves.toMatchObject({
        allowed: false,
        reason: "totp_verify_body_forbidden",
      });
    }
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/two-factor/verify-totp",
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: "two_factor=c" }),
        body: { code: "123456", trustDevice: true },
        twoFactorCookieValue: "c",
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "totp_verify_body_forbidden",
    });
  });

  it("allows bounded sign-out only with a session cookie and same-origin, without trust_device", async () => {
    candidate();
    const gate = (headers: Record<string, string>) =>
      evaluateCandidateReadOnlyRequest({
        method: "POST",
        pathname: "/api/auth/sign-out",
        headers: new Headers(headers),
      });
    expect(gate({ origin: ORIGIN, cookie: session })).toEqual({
      allowed: true,
      reason: "allowed_session_sign_out",
    });
    const denied: Array<Record<string, string>> = [
      { origin: ORIGIN },
      { origin: "https://evil.example", cookie: session },
      { cookie: session },
      { origin: ORIGIN, cookie: `${session}; better-auth.trust_device=v` },
    ];
    for (const headers of denied) {
      expect(gate(headers), JSON.stringify(headers)).toMatchObject({
        allowed: false,
      });
    }

    const hook = (extra: Record<string, unknown>) =>
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-out",
        method: "POST",
        portal: "agent",
        headers: new Headers({ origin: ORIGIN, cookie: session }),
        ...extra,
      });
    await expect(hook({ existingSessionUserId: "usr_1" })).resolves.toEqual({
      allowed: true,
    });
    await expect(hook({})).resolves.toMatchObject({ allowed: false });
    await expect(
      hook({ existingSessionUserId: "usr_1", sessionImpersonatedBy: "adm_1" }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "impersonation_sign_out_forbidden",
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-out",
        method: "POST",
        portal: "agent",
        headers: new Headers({ cookie: session }),
        existingSessionUserId: "usr_1",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("fails closed when case-variant emails make the sign-in lookup ambiguous", async () => {
    candidate();
    bootMocks.findCandidateSignInUserByEmail.mockResolvedValueOnce({
      ambiguousEmail: true,
    });
    await expect(
      assertCandidateReadOnlyAuthActionAllowed({
        path: "/sign-in/email",
        method: "POST",
        portal: "agent",
        headers: new Headers({ origin: ORIGIN }),
        body: { email: "A@b.c", password: "x" },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: "ambiguous_email_forbidden",
    });
  });

  it("masks magic-link and email-OTP providers in candidate mode only", () => {
    const providers = {
      password: true,
      magicLink: true,
      emailOtp: true,
    } as unknown as Parameters<typeof effectiveLocalAuthProviders>[0];
    expect(effectiveLocalAuthProviders(providers)).toMatchObject({
      magicLink: true,
    });
    candidate();
    expect(effectiveLocalAuthProviders(providers)).toMatchObject({
      password: true,
      magicLink: false,
      emailOtp: false,
    });
  });
});
