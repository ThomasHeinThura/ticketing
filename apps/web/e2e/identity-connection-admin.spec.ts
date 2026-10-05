import { expect, test } from "@playwright/test";

const workspaceId = "workspace-identity-admin-e2e";
const session = {
  session: {
    id: "session-identity-admin-e2e",
    userId: "user-identity-admin-e2e",
    token: "session-token-identity-admin-e2e",
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    portal: "agent",
    activeOrganizationId: workspaceId,
  },
  user: {
    id: "user-identity-admin-e2e",
    name: "Identity Administrator",
    email: "identity-admin@example.test",
    emailVerified: true,
    image: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  },
};

test("creates a disabled Entra connection through the reachable God Mode form", async ({
  page,
}) => {
  const unexpectedApiRequests: string[] = [];
  let createBody: Record<string, unknown> | null = null;
  const operationBindings: Array<Record<string, unknown>> = [];
  const connectionId = "connection-created-by-admin-e2e";
  const createdConnection = {
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: null,
    displayName: "Staff sign-in",
    issuer: `https://login.microsoftonline.com/${"11223344-5566-7788-9900-aabbccddeeff"}/v2.0`,
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
    enabled: false,
    configVersion: 1,
    healthState: "unknown",
    healthCheckedAt: null,
  };

  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    unexpectedApiRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unexpected API request" }),
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
          name: "Internal workspace",
          slug: "internal-workspace",
          logo: null,
          description: null,
          createdAt: "2026-10-05T00:00:00.000Z",
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
        token: "csrf-identity-admin-e2e",
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
        logLevels: { default: "warn", modules: {} },
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
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ instanceAdmin: true }),
    }),
  );
  await page.route("**/api/instance/identity-connections", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
      return;
    }
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data: createdConnection }),
    });
  });
  await page.route("**/api/me/step-up/challenges", async (route) => {
    operationBindings.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        challengeId: "challenge-identity-e2e",
        nonce: "nonce-identity-e2e",
      }),
    });
  });
  await page.route("**/api/me/step-up", async (route) => {
    operationBindings.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "proof-identity-e2e" }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/god-mode/authentication/new");
  await expect(
    page.getByRole("heading", { name: "Add Entra connection" }),
  ).toBeVisible();
  await page.getByLabel("Connection name").fill("Staff sign-in");
  await page
    .getByLabel("Entra tenant ID")
    .fill("11223344-5566-7788-9900-aabbccddeeff");
  await page
    .getByLabel("Application client ID")
    .fill("22334455-6677-8899-aabb-ccddeeff0011");
  await page.getByLabel("Client secret").fill("e2e-only-secret-value");
  await page
    .locator("#identity-connection-auth-value")
    .fill("e2e-only-password");
  await page
    .getByRole("button", { name: "Create disabled connection" })
    .click();
  await expect(
    page.getByRole("region", { name: "Identity connection created" }),
  ).toBeVisible();
  await expect(
    page.getByText("The connection is disabled at version 1."),
  ).toBeVisible();
  expect(createBody).toMatchObject({
    displayName: "Staff sign-in",
    portalScope: "agent",
    tenantId: "11223344-5566-7788-9900-aabbccddeeff",
    clientId: "22334455-6677-8899-aabb-ccddeeff0011",
    clientSecret: "e2e-only-secret-value",
  });
  expect(operationBindings).toHaveLength(2);
  expect(operationBindings[0]).toMatchObject({
    kind: "operation",
    operation: "identity_connection_create",
    request: {
      displayName: "Staff sign-in",
      clientSecret: "e2e-only-secret-value",
    },
  });
  expect(operationBindings[1]).toMatchObject({
    kind: "operation",
    operation: "identity_connection_create",
    challengeId: "challenge-identity-e2e",
    nonce: "nonce-identity-e2e",
  });
  await expect(page.locator("#identity-connection-secret")).toHaveCount(0);
  expect(unexpectedApiRequests).toEqual([]);
});
