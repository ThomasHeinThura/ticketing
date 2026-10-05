import { expect, test } from "@playwright/test";

const connectionId = "connection-event-history-e2e";
const workspaceId = "workspace-event-history-e2e";
const session = {
  session: {
    id: "session-event-history-e2e",
    userId: "user-event-history-e2e",
    token: "session-token-event-history-e2e",
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    portal: "agent",
    activeOrganizationId: workspaceId,
  },
  user: {
    id: "user-event-history-e2e",
    name: "Identity Administrator",
    email: "identity-admin@example.test",
    emailVerified: true,
    image: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  },
};

const connection = {
  id: connectionId,
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  defaultWorkspaceId: null,
  displayName: "Staff sign-in",
  issuer:
    "https://login.microsoftonline.com/11223344-5566-7788-9900-aabbccddeeff/v2.0",
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
  configVersion: 3,
  healthState: "unknown",
  healthCheckedAt: null,
};

test("opens and pages the safe connection-scoped provisioning history", async ({
  page,
}) => {
  const unexpectedApiRequests: string[] = [];
  const eventRequests: Array<{ cursor: string; limit: string | null }> = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    unexpectedApiRequests.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unexpected API request" }),
    });
  });
  const json = (data: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });

  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill(json(session)),
  );
  await page.route("**/api/config**", (route) =>
    route.fulfill(
      json({
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
    ),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill(
      json([
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
    ),
  );
  await page.route("**/api/me/security/factors", (route) =>
    route.fulfill(json({ required: false, enabled: true })),
  );
  await page.route("**/api/me/csrf-token", (route) =>
    route.fulfill(
      json({
        token: "csrf-event-history-e2e",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    ),
  );
  await page.route("**/api/instance/observability", (route) =>
    route.fulfill(
      json({
        version: 1,
        logLevels: { default: "warn", modules: {} },
        metricsTokenConfigured: false,
        metricsTokenRotatedAt: null,
      }),
    ),
  );
  await page.route("**/api/instance/local-factor-policy", (route) =>
    route.fulfill(json({ policy: { mode: "off", requiredRoleId: null } })),
  );
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill(json({ instanceAdmin: true })),
  );
  await page.route("**/api/instance/identity-connections", (route) =>
    route.fulfill(json({ data: [connection] })),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim`,
    (route) =>
      route.fulfill(
        json({
          data: {
            enabled: false,
            allowedResources: ["users"],
            lifecyclePolicy: "end_memberships",
            matchAttributes: ["externalId", "userName"],
            attributeMapping: {
              version: 1,
              name: "displayName",
              email: "userName",
              jobTitle: "title",
              locale: "preferredLanguage",
            },
            mappings: [],
          },
          configVersion: 3,
        }),
      ),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/scim/mapping-options**`,
    (route) =>
      route.fulfill(
        json({ kind: "agent_targets", data: [], nextCursor: null }),
      ),
  );
  await page.route(
    `**/api/instance/identity-connections/${connectionId}/events**`,
    async (route) => {
      const url = new URL(route.request().url());
      eventRequests.push({
        cursor: url.searchParams.get("cursor") ?? "first",
        limit: url.searchParams.get("limit"),
      });
      if (url.searchParams.has("cursor")) {
        await route.fulfill(
          json({
            data: [
              {
                kind: "user.created",
                outcome: "success",
                actorType: "scim",
                createdAt: "2026-10-04T09:15:00.000Z",
              },
            ],
            page: { nextCursor: null, hasMore: false },
          }),
        );
        return;
      }
      await route.fulfill(
        json({
          data: [
            {
              kind: "user.updated",
              outcome: "success",
              actorType: "scim",
              createdAt: "2026-10-05T09:15:00.000Z",
            },
          ],
          page: { nextCursor: "opaque-connection-bound-cursor", hasMore: true },
        }),
      );
    },
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/god-mode/authentication/${connectionId}`);
  await expect(
    page.getByRole("heading", { name: "Provisioning history" }),
  ).toBeVisible();
  await expect(page.getByText("user.updated")).toBeVisible();
  await expect(page.getByText("success · scim ·")).toBeVisible();
  await page.getByRole("button", { name: "Older events" }).click();
  await expect(page).toHaveURL(/eventsCursor=opaque-connection-bound-cursor/u);
  await expect(page.getByText("user.created")).toBeVisible();
  expect(eventRequests.every((request) => request.limit === "25")).toBe(true);
  expect(new Set(eventRequests.map((request) => request.cursor))).toEqual(
    new Set(["first", "opaque-connection-bound-cursor"]),
  );
  expect(unexpectedApiRequests).toEqual([]);
});
