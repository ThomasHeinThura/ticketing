import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";

const uiRequire = createRequire(
  new URL("../../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

export async function expectNoSeriousAxeViolations(page: Page) {
  if (
    !(await page.evaluate(() =>
      Boolean((window as Window & { axe?: unknown }).axe),
    ))
  )
    await page.addScriptTag({ content: axeCoreSource });
  const violations = await page.evaluate(async () => {
    type Axe = {
      run: (context: Document) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          help: string;
          nodes: Array<{ target: string[] }>;
        }>;
      }>;
    };
    const axe = (window as typeof window & { axe: Axe }).axe;
    const result = await axe.run(document);
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes }));
  });
  expect(violations).toEqual([]);
}

export type FixtureConnection = {
  id: string;
  providerType: "entra";
  portalScope: "agent" | "customer";
  organisationId: string | null;
  defaultWorkspaceId: string | null;
  displayName: string;
  issuer: string;
  tenantId: string | null;
  clientId: string;
  clientSecretConfigured: boolean;
  redirectUri: string;
  scopes: string[];
  claimMapping: { version: 1; displayName: "name" } | null;
  claimMappingState: "default" | "valid" | "invalid";
  domainBindings: string[];
  jitPolicy: {
    enabled: boolean;
    default_role_id: string | null;
    required_entra_app_role: string;
  };
  maxRoleRank: number | null;
  mfaUpstreamMode: "off";
  enabled: boolean;
  configVersion: number;
  healthState: "unknown" | "healthy" | "degraded" | "invalid";
  healthCheckedAt: string | null;
};

export const TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
/** Obviously fake; never a real credential shape. */
export const FAKE_BEARER = "fake-bearer-fixture-value-0000000000000000";

export function staffConnection(
  overrides: Partial<FixtureConnection> = {},
): FixtureConnection {
  return {
    id: "conn-staff",
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: "workspace-1",
    displayName: "Staff Entra",
    issuer: "https://login.example.test/tenant/v2.0",
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecretConfigured: true,
    redirectUri: "https://desk.example.test/api/auth/callback/conn-staff",
    scopes: ["openid", "profile", "email"],
    claimMapping: { version: 1, displayName: "name" },
    claimMappingState: "valid",
    domainBindings: ["example.test"],
    jitPolicy: {
      enabled: false,
      default_role_id: null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: 10,
    mfaUpstreamMode: "off",
    enabled: false,
    configVersion: 7,
    healthState: "healthy",
    healthCheckedAt: null,
    ...overrides,
  };
}

export type ScimState = {
  enabled: boolean;
  allowedResources: Array<"users" | "groups">;
  lifecyclePolicy: "end_memberships" | "keep_memberships";
  matchAttributes: string[];
  attributeMapping: Record<string, string | number>;
  mappings: Array<{
    id: string;
    externalGroupId: string;
    externalGroupNameSnapshot: string | null;
    roleId: string;
    scope: "workspace" | "organisation";
    scopeId: string;
    enabled: boolean;
  }>;
};

export type IdentityEvent = {
  kind: string;
  outcome: string;
  actorType: "person" | "scim" | "oidc";
  createdAt: string;
};

export type IdentityAdminFixture = {
  connections: FixtureConnection[];
  scim: ScimState;
  events: IdentityEvent[];
  /** Pages of events; the cursor of page n is `cursor-n`. */
  eventPages: IdentityEvent[][];
  /** Failure injection. */
  listStatus: number;
  /** Better Auth user role: the client-side instance-admin signal. */
  sessionRole: string;
  stepUpChallengeStatus: number;
  /** When set, the next mutation answers with this status/body (then clears). */
  nextMutation: { status: number; body: unknown; text?: boolean } | null;
  tokenPresent: boolean;
  challenges: unknown[];
  proofs: unknown[];
  /** `{ method, path, token, body }` of every mutation request. */
  mutations: Array<{
    method: string;
    path: string;
    token: string | undefined;
    body: unknown;
  }>;
  requests: string[];
};

export function newIdentityFixture(): IdentityAdminFixture {
  return {
    connections: [
      staffConnection(),
      staffConnection({
        id: "conn-customer",
        portalScope: "customer",
        organisationId: "org-1",
        defaultWorkspaceId: null,
        maxRoleRank: null,
        displayName: "Contoso customers",
        enabled: true,
      }),
    ],
    scim: {
      enabled: false,
      allowedResources: ["users", "groups"],
      lifecyclePolicy: "end_memberships",
      matchAttributes: ["externalId", "userName"],
      attributeMapping: {
        version: 1,
        name: "displayName",
        email: "emails.primary.value",
        jobTitle: "title",
        locale: "preferredLanguage",
      },
      mappings: [
        {
          id: "mapping-1",
          externalGroupId: "group-support",
          externalGroupNameSnapshot: "Support",
          roleId: "role-agent",
          scope: "workspace",
          scopeId: "workspace-1",
          enabled: true,
        },
      ],
    },
    events: [],
    eventPages: [
      [
        {
          kind: "token.rotated",
          outcome: "succeeded",
          actorType: "person",
          createdAt: "2026-10-15T10:30:00.000Z",
        },
        {
          kind: "user.created",
          outcome: "succeeded",
          actorType: "scim",
          createdAt: "2026-10-15T10:00:00.000Z",
        },
      ],
      [
        {
          kind: "request.denied",
          outcome: "denied",
          actorType: "scim",
          createdAt: "2026-10-14T09:00:00.000Z",
        },
      ],
    ],
    listStatus: 200,
    sessionRole: "admin",
    stepUpChallengeStatus: 200,
    nextMutation: null,
    tokenPresent: false,
    challenges: [],
    proofs: [],
    mutations: [],
    requests: [],
  };
}

const session = {
  session: {
    id: "current-session",
    userId: "actor-admin",
    activeOrganizationId: "workspace-1",
    expiresAt: "2030-01-01T00:00:00.000Z",
    createdAt: "2026-10-05T00:00:00.000Z",
  },
  user: {
    id: "actor-admin",
    name: "Instance Admin",
    email: "admin@example.test",
    role: "admin",
    emailVerified: true,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
};

function scimResponse(fixture: IdentityAdminFixture, version: number) {
  return { data: fixture.scim, configVersion: version };
}

/** Installs a stateful mock of the accepted identity administration API and its shell calls. */
export async function installIdentityAdminFixture(
  page: Page,
  fixture: IdentityAdminFixture,
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    fixture.requests.push(`${method} ${path}${url.search}`);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const text = (body: string, status: number) =>
      route.fulfill({ status, contentType: "text/plain", body });

    if (path === "/api/auth/get-session")
      return json({
        ...session,
        user: { ...session.user, role: fixture.sessionRole },
      });
    if (path === "/api/config")
      return json({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: true,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    if (path === "/api/workspace")
      return json([
        {
          id: "workspace-1",
          name: "Operations",
          slug: "operations",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ]);
    if (path === "/api/me/security/factors")
      return json({
        enabled: true,
        required: false,
        bootstrapRequired: false,
        policyMode: "optional",
      });
    if (path === "/api/me/csrf-token")
      return json({
        token: "csrf-fixture",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    if (method === "GET" && !path.startsWith("/api/instance")) return json([]);

    if (path === "/api/me/step-up/challenges" && method === "POST") {
      fixture.challenges.push(request.postDataJSON());
      if (fixture.stepUpChallengeStatus !== 200)
        return text("step_up_unavailable", fixture.stepUpChallengeStatus);
      return json({
        challengeId: "challenge-fixture",
        nonce: "n".repeat(43),
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    }
    if (path === "/api/me/step-up" && method === "POST") {
      fixture.proofs.push(request.postDataJSON());
      return json({
        token: "p".repeat(43),
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    }

    const connectionMatch =
      /^\/api\/instance\/identity-connections(?:\/([^/]+))?(?:\/(.+))?$/u.exec(
        path,
      );
    if (!connectionMatch) return json({}, 404);
    const [, id, rest] = connectionMatch;

    if (method !== "GET") {
      fixture.mutations.push({
        method,
        path,
        token: request.headers()["x-taskdesk-step-up-token"],
        body: request.postDataJSON(),
      });
      if (fixture.nextMutation) {
        const failure = fixture.nextMutation;
        fixture.nextMutation = null;
        return failure.text
          ? text(String(failure.body), failure.status)
          : json(failure.body, failure.status);
      }
    }

    if (!id && method === "GET") {
      if (fixture.listStatus !== 200)
        return fixture.listStatus === 403
          ? text("Forbidden", 403)
          : json(
              { message: "Stored identity configuration is invalid" },
              fixture.listStatus,
            );
      return json({ data: fixture.connections });
    }
    if (!id && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = staffConnection({
        id: "conn-created",
        displayName: String(body.displayName),
        configVersion: 1,
        enabled: false,
        tenantId: String(body.tenantId),
        clientId: String(body.clientId),
      });
      fixture.connections.push(created);
      return json({ data: created }, 201);
    }
    const connection = fixture.connections.find((item) => item.id === id);
    if (!connection) return json({ message: "Connection unavailable" }, 404);

    if (!rest && method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown> & {
        configVersion: number;
      };
      if (body.configVersion !== connection.configVersion)
        return json(
          {
            message: "version_conflict",
            currentVersion: connection.configVersion,
          },
          409,
        );
      Object.assign(connection, {
        ...(typeof body.displayName === "string"
          ? { displayName: body.displayName }
          : {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        configVersion: connection.configVersion + 1,
      });
      return json({ data: connection });
    }
    if (rest === "events" && method === "GET") {
      const cursor = url.searchParams.get("cursor");
      const index = cursor ? Number(cursor.replace("cursor-", "")) : 0;
      const pageEvents = fixture.eventPages[index] ?? [];
      const hasMore = index + 1 < fixture.eventPages.length;
      return json({
        data: pageEvents,
        page: { nextCursor: hasMore ? `cursor-${index + 1}` : null, hasMore },
      });
    }
    if (rest === "scim" && method === "GET")
      return json(scimResponse(fixture, connection.configVersion));
    if (rest === "scim/mapping-options" && method === "GET") {
      const workspaceId = url.searchParams.get("workspaceId");
      return json(
        workspaceId
          ? {
              kind: "agent_roles",
              target: { id: workspaceId, name: "Operations" },
              data: [{ id: "role-agent", name: "Agent", rank: 3 }],
              nextCursor: null,
            }
          : {
              kind: "agent_targets",
              data: [{ id: "workspace-1", name: "Operations" }],
              nextCursor: null,
            },
      );
    }
    if (rest === "scim" && method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown> & {
        configVersion: number;
        kind: string;
      };
      if (body.configVersion !== connection.configVersion)
        return json(
          {
            type: "about:blank",
            title: "Version conflict",
            status: 409,
            currentVersion: connection.configVersion,
          },
          409,
        );
      if (body.kind === "settings") {
        if (body.enabled === true && !fixture.tokenPresent)
          return json(
            { type: "about:blank", title: "Invalid request", status: 422 },
            422,
          );
        for (const key of [
          "enabled",
          "allowedResources",
          "lifecyclePolicy",
          "matchAttributes",
        ] as const)
          if (body[key] !== undefined)
            (fixture.scim as Record<string, unknown>)[key] = body[key];
      } else if (body.kind === "attribute_mapping") {
        fixture.scim.attributeMapping = body.attributeMapping as Record<
          string,
          string | number
        >;
      } else if (body.kind === "mapping_create") {
        fixture.scim.mappings.push({
          id: `mapping-${fixture.scim.mappings.length + 1}`,
          externalGroupId: String(body.externalGroupId),
          externalGroupNameSnapshot:
            (body.externalGroupNameSnapshot as string | null) ?? null,
          roleId: String(body.roleId),
          scope: "workspace",
          scopeId: String(body.scopeId),
          enabled: body.enabled !== false,
        });
      } else if (body.kind === "mapping_update") {
        const mapping = fixture.scim.mappings.find(
          (item) => item.id === body.mappingId,
        );
        if (!mapping)
          return json(
            { type: "about:blank", title: "Not found", status: 404 },
            404,
          );
        if (typeof body.enabled === "boolean") mapping.enabled = body.enabled;
      }
      connection.configVersion += 1;
      return json(scimResponse(fixture, connection.configVersion));
    }
    if (rest === "scim/rotate-token" && method === "POST") {
      connection.configVersion += 1;
      fixture.tokenPresent = true;
      fixture.scim.enabled = false;
      return json({
        configVersion: connection.configVersion,
        token: FAKE_BEARER.padEnd(43, "0").slice(0, 43),
        tokenRotatedAt: "2026-10-15T10:45:00.000Z",
      });
    }
    if (rest === "scim/revoke-token" && method === "POST") {
      if (!fixture.tokenPresent)
        return json({ message: "Token operation unavailable" }, 422);
      connection.configVersion += 1;
      fixture.tokenPresent = false;
      fixture.scim.enabled = false;
      return json({ configVersion: connection.configVersion, revoked: true });
    }
    return json({}, 404);
  });
}

export async function enterVerification(page: Page, value = "123456") {
  // The fixture reports an enrolled authenticator, so the default factor is a code.
  await page.getByLabel("Authenticator code").first().fill(value);
}
