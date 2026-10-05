import { expect, test } from "@playwright/test";

const workspaceId = "workspace-scim-e2e";
const connectionId = "connection-scim-e2e";
const session = {
  session: {
    id: "session-scim-e2e",
    userId: "user-scim-e2e",
    token: "session-token-scim-e2e",
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    activeOrganizationId: workspaceId,
  },
  user: {
    id: "user-scim-e2e",
    name: "Identity Admin",
    email: "identity-admin@example.test",
    emailVerified: true,
    image: null,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
};

function settings(
  configVersion: number,
  matchAttributes: string[],
  allowedResources: string[],
  lifecyclePolicy: "end_memberships" | "keep_memberships",
  attributeMapping = {
    version: 1,
    name: "displayName",
    email: "userName",
    jobTitle: "unmapped",
    locale: "unmapped",
  },
  mappings: Array<Record<string, unknown>> = [],
) {
  return {
    data: {
      enabled: true,
      allowedResources,
      lifecyclePolicy,
      matchAttributes,
      attributeMapping,
      mappings,
    },
    configVersion,
  };
}

test("God Mode SCIM settings and token lifecycle use distinct bound step-up operations", async ({
  page,
}, testInfo) => {
  let savedRequest: Record<string, unknown> | null = null;
  let rotateRequest: Record<string, unknown> | null = null;
  let enableRequest: Record<string, unknown> | null = null;
  let revokeRequest: Record<string, unknown> | null = null;
  const stepUpBindings: Record<string, unknown>[] = [];
  const relevantResponses: string[] = [];
  const unexpectedApiRequests: string[] = [];
  const requiredMatchAttributes = ["externalId", "userName"];
  let configVersion = 4;
  let matchAttributes = [...requiredMatchAttributes];
  let allowedResources = ["users"];
  let lifecyclePolicy: "end_memberships" | "keep_memberships" =
    "end_memberships";
  let attributeMapping = {
    version: 1,
    name: "displayName",
    email: "userName",
    jobTitle: "unmapped",
    locale: "unmapped",
  };
  let mappings: Array<Record<string, unknown>> = [];
  let groupMappingRequest: Record<string, unknown> | null = null;
  const mappingOptionRequests: string[] = [];

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/api/me/step-up")) {
      relevantResponses.push(
        `${response.request().method()} ${url.pathname} ${response.status()}`,
      );
    } else if (url.pathname.includes("/scim")) {
      relevantResponses.push(
        `${response.request().method()} ${url.pathname} ${response.status()}`,
      );
    }
  });

  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    unexpectedApiRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Unexpected API request in SCIM UI test",
      }),
    });
  });
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session),
    }),
  );
  await page.route("**/api/config**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      }),
    }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: workspaceId,
          name: "SCIM UI workspace",
          slug: "scim-ui-workspace",
          logo: null,
          description: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          role: "owner",
        },
      ]),
    }),
  );
  await page.route("**/api/me/security/factors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ required: false, enabled: true }),
    }),
  );
  await page.route("**/api/me/csrf-token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "csrf-scim-e2e",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    }),
  );
  await page.route("**/api/instance/observability", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        logLevels: {
          default: "warn",
          modules: {
            http: "warn",
            auth: "warn",
            database: "warn",
            jobs: "warn",
            audit: "warn",
            plugins: "warn",
          },
        },
        metricsTokenConfigured: false,
        metricsTokenRotatedAt: null,
      }),
    }),
  );
  await page.route("**/api/instance/local-factor-policy", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ policy: { mode: "off", requiredRoleId: null } }),
    }),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/events**`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          page: { nextCursor: null, hasMore: false },
        }),
      }),
  );
  await page.route("**/api/instance/identity-connections", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: connectionId,
            providerType: "entra",
            portalScope: "agent",
            organisationId: null,
            defaultWorkspaceId: null,
            displayName: "Staff Entra",
            tenantId: "11223344-5566-7788-9900-aabbccddeeff",
            clientId: "22334455-6677-8899-aabb-ccddeeff0011",
            clientSecretConfigured: true,
            redirectUri:
              "https://portal.example.test/api/auth/oauth2/callback/entra-agent",
            scopes: ["openid", "profile", "email"],
            claimMapping: { version: 1, displayName: "name" },
            claimMappingState: "valid",
            domainBindings: [],
            jitPolicy: {
              enabled: false,
              default_role_id: null,
              required_entra_app_role: "TaskDesk.User",
            },
            maxRoleRank: 10,
            mfaUpstreamMode: "off",
            enabled: true,
            configVersion: 1,
            healthState: "healthy",
            healthCheckedAt: "2026-10-05T00:00:00.000Z",
          },
        ],
      }),
    }),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim/mapping-options**`,
    async (route) => {
      const url = new URL(route.request().url());
      mappingOptionRequests.push(url.search);
      const body = url.searchParams.has("workspaceId")
        ? {
            kind: "agent_roles",
            target: { id: "workspace-scim-target", name: "Support workspace" },
            data: [{ id: "role-scim-responder", name: "Responder", rank: 3 }],
            nextCursor: null,
          }
        : {
            kind: "agent_targets",
            data: [
              {
                id: "workspace-scim-target",
                name: "Support workspace",
              },
            ],
            nextCursor: null,
          };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    },
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            settings(
              configVersion,
              matchAttributes,
              allowedResources,
              lifecyclePolicy,
              attributeMapping,
              mappings,
            ),
          ),
        });
        return;
      }
      const request = route.request().postDataJSON() as Record<string, unknown>;
      if (request.kind === "mapping_create") {
        groupMappingRequest = request;
        configVersion += 1;
        mappings = [
          {
            id: "mapping-scim-e2e",
            externalGroupId: request.externalGroupId,
            externalGroupNameSnapshot: request.externalGroupNameSnapshot,
            roleId: request.roleId,
            scope: request.scope,
            scopeId: request.scopeId,
            enabled: true,
          },
        ];
      } else if (request.enabled === true) {
        enableRequest = request;
        configVersion += 1;
      } else if (request.kind === "attribute_mapping") {
        attributeMapping = request.attributeMapping;
        configVersion = 6;
      } else {
        savedRequest = request;
        configVersion = 5;
        matchAttributes = request.matchAttributes;
        allowedResources = request.allowedResources;
        lifecyclePolicy = request.lifecyclePolicy;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          settings(
            configVersion,
            matchAttributes,
            allowedResources,
            lifecyclePolicy,
            attributeMapping,
            mappings,
          ),
        ),
      });
    },
  );
  await page.route("**/api/me/step-up/challenges", async (route) => {
    stepUpBindings.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        challengeId: "challenge-scim-e2e",
        nonce: "nonce-scim-e2e",
      }),
    });
  });
  await page.route("**/api/me/step-up", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "proof-scim-e2e" }),
    }),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim/rotate-token`,
    async (route) => {
      rotateRequest = route.request().postDataJSON() as Record<string, unknown>;
      configVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          configVersion,
          token: "one-time-fixture-bearer",
          tokenRotatedAt: "2026-10-04T12:00:00.000Z",
        }),
      });
    },
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim/revoke-token`,
    async (route) => {
      revokeRequest = route.request().postDataJSON() as Record<string, unknown>;
      configVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({ configVersion, revoked: true }),
      });
    },
  );

  await page.goto("/god-mode/observability");
  await page.getByRole("link", { name: "Authentication settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Identity connections" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Manage settings" }).click();
  await expect(
    page.getByRole("heading", { name: "SCIM configuration" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("scim-configuration.png"),
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "SCIM configuration" })
    .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: testInfo.outputPath("scim-configuration-viewport.png"),
  });

  await page.getByRole("checkbox", { name: "title" }).click();
  await page.getByRole("checkbox", { name: "Groups" }).click();
  await page
    .getByRole("combobox", { name: "User deactivation policy" })
    .click();
  await page.getByRole("option", { name: "Keep sourced memberships" }).click();
  await page.locator("#scim-step-up-secret").fill("test-only-password");
  await page.getByRole("button", { name: "Save SCIM settings" }).click();

  await expect(
    page.getByText("Configuration version 5"),
    relevantResponses.join("; "),
  ).toBeVisible();
  expect(stepUpBindings[0]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId,
    request: {
      configVersion: 4,
      kind: "settings",
      allowedResources: ["users", "groups"],
      lifecyclePolicy: "keep_memberships",
      matchAttributes: ["externalId", "userName", "title"],
    },
  });
  expect(savedRequest).toEqual({
    configVersion: 4,
    kind: "settings",
    allowedResources: ["users", "groups"],
    lifecyclePolicy: "keep_memberships",
    matchAttributes: ["externalId", "userName", "title"],
  });

  await page.getByRole("combobox", { name: "Display name source" }).click();
  await page.getByRole("option", { name: "name.formatted" }).click();
  await page.locator("#scim-step-up-secret").fill("test-only-password");
  await page.getByRole("button", { name: "Save profile mapping" }).click();
  await expect(page.getByText("Configuration version 6")).toBeVisible();
  expect(stepUpBindings[1]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId,
    request: {
      configVersion: 5,
      kind: "attribute_mapping",
      attributeMapping: {
        version: 1,
        name: "name.formatted",
        email: "userName",
        jobTitle: "unmapped",
        locale: "unmapped",
      },
    },
  });

  const mappingForm = page
    .locator("form")
    .filter({ has: page.getByLabel("External group identifier") });
  await mappingForm
    .getByLabel("External group identifier")
    .fill("entra-group-scim-e2e");
  await mappingForm
    .getByLabel("Display name (optional)")
    .fill("Service desk responders");
  await mappingForm
    .getByRole("combobox", { name: "Internal workspace" })
    .click();
  await page.getByRole("option", { name: "Support workspace" }).click();
  await mappingForm.getByRole("combobox", { name: "Eligible role" }).click();
  await page.getByRole("option", { name: "Responder · rank 3" }).click();
  await mappingForm.getByLabel("Password").fill("test-only-password");
  await mappingForm.getByRole("button", { name: "Create mapping" }).click();
  await expect(
    page.getByText("entra-group-scim-e2e · role role-scim-responder"),
  ).toBeVisible();
  expect(
    mappingOptionRequests.some((query) =>
      query.includes("workspaceId=workspace-scim-target"),
    ),
  ).toBe(true);
  expect(groupMappingRequest).toEqual({
    configVersion: 6,
    kind: "mapping_create",
    externalGroupId: "entra-group-scim-e2e",
    externalGroupNameSnapshot: "Service desk responders",
    roleId: "role-scim-responder",
    scope: "workspace",
    scopeId: "workspace-scim-target",
    enabled: true,
  });
  expect(stepUpBindings[2]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId,
    request: groupMappingRequest,
  });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Issue or rotate token" }).click();
  await expect(page.getByLabel("New token — copy it now")).toHaveValue(
    "one-time-fixture-bearer",
  );
  expect(stepUpBindings[3]).toEqual({
    kind: "operation",
    operation: "scim_token_rotate",
    connectionId,
    version: 7,
  });
  expect(rotateRequest).toEqual({ version: 7 });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Re-enable SCIM" }).click();
  await expect(
    page.getByText("SCIM is enabled with the current bearer token."),
  ).toBeVisible();
  expect(stepUpBindings[4]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId,
    request: { configVersion: 8, kind: "settings", enabled: true },
  });
  expect(enableRequest).toEqual({
    configVersion: 8,
    kind: "settings",
    enabled: true,
  });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText(/bearer was revoked/u)).toBeVisible();
  expect(stepUpBindings[5]).toEqual({
    kind: "operation",
    operation: "scim_token_revoke",
    connectionId,
    version: 9,
  });
  expect(revokeRequest).toEqual({ version: 9 });
  expect(unexpectedApiRequests).toEqual([]);
});
