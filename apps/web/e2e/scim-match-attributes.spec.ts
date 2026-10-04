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

test("God Mode SCIM match attributes navigate, confirm, and save the exact bound settings", async ({
  page,
}) => {
  let savedRequest: Record<string, unknown> | null = null;
  let stepUpBinding: Record<string, unknown> | null = null;
  const relevantResponses: string[] = [];
  const unexpectedApiRequests: string[] = [];
  const requiredMatchAttributes = ["externalId", "userName"];

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/api/me/step-up")) {
      relevantResponses.push(
        `${response.request().method()} ${url.pathname} ${response.status()}`,
      );
    } else if (url.pathname.endsWith("/scim")) {
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
          body: JSON.stringify(settings(4, requiredMatchAttributes)),
        });
        return;
      }
      savedRequest = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(settings(5, ["externalId", "userName", "title"])),
      });
    },
  );
  await page.route("**/api/me/step-up/challenges", async (route) => {
    stepUpBinding = route.request().postDataJSON() as Record<string, unknown>;
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
  await page.getByLabel("Password").fill("test-only-password");
  await page.getByRole("button", { name: "Save match attributes" }).click();

  await expect(
    page.getByText("Configuration version 5"),
    relevantResponses.join("; "),
  ).toBeVisible();
  expect(stepUpBinding).toEqual({
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
  expect(unexpectedApiRequests).toEqual([]);
});
