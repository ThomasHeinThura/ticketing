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

function settings(configVersion: number, matchAttributes: string[]) {
  return {
    data: {
      enabled: true,
      allowedResources: ["users"],
      lifecyclePolicy: "end_memberships",
      matchAttributes,
      attributeMapping: {
        version: 1,
        name: "displayName",
        email: "userName",
        jobTitle: "unmapped",
        locale: "unmapped",
      },
      mappings: [],
    },
    configVersion,
  };
}

test("God Mode SCIM settings and token lifecycle use distinct bound step-up operations", async ({
  page,
}) => {
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
            displayName: "Staff Entra",
            enabled: true,
            configVersion: 1,
          },
        ],
      }),
    }),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim`,
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(settings(configVersion, matchAttributes)),
        });
        return;
      }
      const request = route.request().postDataJSON() as Record<string, unknown>;
      if (request.enabled === true) {
        enableRequest = request;
        configVersion = 7;
      } else {
        savedRequest = request;
        configVersion = 5;
        matchAttributes = ["externalId", "userName", "title"];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(settings(configVersion, matchAttributes)),
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
      configVersion = 6;
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
      configVersion = 8;
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
  await page.getByRole("link", { name: "SCIM settings" }).click();
  await expect(
    page.getByRole("heading", { name: "SCIM user lookup attributes" }),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: "title" }).click();
  await page.getByLabel("Password", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Save match attributes" }).click();

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
      matchAttributes: ["externalId", "userName", "title"],
    },
  });
  expect(savedRequest).toEqual({
    configVersion: 4,
    kind: "settings",
    matchAttributes: ["externalId", "userName", "title"],
  });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Issue or rotate token" }).click();
  await expect(page.getByLabel("New token — copy it now")).toHaveValue(
    "one-time-fixture-bearer",
  );
  expect(stepUpBindings[1]).toEqual({
    kind: "operation",
    operation: "scim_token_rotate",
    connectionId,
    version: 5,
  });
  expect(rotateRequest).toEqual({ version: 5 });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Re-enable SCIM" }).click();
  await expect(
    page.getByText("SCIM is enabled with the current bearer token."),
  ).toBeVisible();
  expect(stepUpBindings[2]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId,
    request: { configVersion: 6, kind: "settings", enabled: true },
  });
  expect(enableRequest).toEqual({
    configVersion: 6,
    kind: "settings",
    enabled: true,
  });

  await page.getByLabel("Token operation password").fill("test-only-password");
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText(/bearer was revoked/u)).toBeVisible();
  expect(stepUpBindings[3]).toEqual({
    kind: "operation",
    operation: "scim_token_revoke",
    connectionId,
    version: 7,
  });
  expect(revokeRequest).toEqual({ version: 7 });
  expect(unexpectedApiRequests).toEqual([]);
});
