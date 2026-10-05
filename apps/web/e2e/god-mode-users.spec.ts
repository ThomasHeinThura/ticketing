import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("God Mode users directory supports filters and audited account actions", async ({
  page,
}) => {
  const user = {
    id: "staff-user-1",
    name: "Taylor Staff",
    email: "taylor@example.test",
    emailVerified: true,
    createdAt: "2026-10-01T12:00:00.000Z",
    locale: "en-US",
    isInstanceAdmin: false,
    isSuspended: false,
    suspensionExpiresAt: null as string | null,
    twoFactorEnabled: true,
    person: {
      id: "person-1",
      side: "staff" as const,
      organisationId: null,
      organisationName: null,
      active: true,
      isPlaceholder: false,
    },
  };
  const received: string[] = [];
  let pendingActionState = "pending";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    received.push(`${method} ${path}`);
    const json = (body: unknown, status = 200) => {
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    };

    if (path === "/api/auth/get-session") {
      return json({
        session: {
          id: "current-session",
          userId: "actor-admin",
          activeOrganizationId: "workspace-1",
          expiresAt: "2026-10-06T00:00:00.000Z",
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
      });
    }
    if (path === "/api/config") {
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
    }
    if (path === "/api/workspace") {
      return json([
        {
          id: "workspace-1",
          name: "Operations",
          slug: "operations",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ]);
    }
    if (path === "/api/project" && method === "GET") return json([]);
    if (/^\/api\/workspace\/[^/]+\/members$/u.test(path) && method === "GET")
      return json([]);
    if (path === "/api/notification" && method === "GET") return json([]);
    if (path === "/api/invitation/pending") return json([]);
    if (path === "/api/me/security/factors") {
      return json({
        enabled: true,
        required: false,
        bootstrapRequired: false,
        policyMode: "optional",
      });
    }
    if (path === "/api/me/csrf-token")
      return json({
        token: "csrf-fixture",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
    if (path === "/api/instance/users" && method === "GET") {
      return json({ data: [user], page: { nextCursor: null, hasMore: false } });
    }
    if (path === "/api/instance/users/staff-user-1" && method === "GET") {
      return json(user);
    }
    if (path === "/api/me/pending-actions" && method === "GET") {
      return json({
        data:
          pendingActionState === "pending"
            ? [
                {
                  id: "pending-deactivation-1",
                  action: "user_deactivation",
                  origin: "web",
                  targetType: "person",
                  targetIds: ["person-1"],
                  summary: { email: "taylor@example.test" },
                  confirmation: "typed_name_step_up",
                  state: "pending",
                  createdAt: "2026-10-05T00:00:00.000Z",
                  expiresAt: "2026-10-05T00:15:00.000Z",
                },
                {
                  id: "pending-future-action",
                  action: "future_unregistered_action",
                  origin: "future_source",
                  targetType: "person",
                  targetIds: ["person-1"],
                  summary: {},
                  confirmation: "click",
                  state: "pending",
                  createdAt: "2026-10-05T00:00:00.000Z",
                  expiresAt: "2026-10-05T00:20:00.000Z",
                },
              ]
            : [],
        page: { nextCursor: null, hasMore: false },
      });
    }
    if (
      path === "/api/me/pending-actions/pending-deactivation-1" &&
      method === "GET"
    ) {
      return json({
        id: "pending-deactivation-1",
        action: "user_deactivation",
        origin: "web",
        targetType: "person",
        targetIds: ["person-1"],
        summary: { email: "taylor@example.test" },
        confirmation: "typed_name_step_up",
        state: pendingActionState,
        createdAt: "2026-10-05T00:00:00.000Z",
        expiresAt: "2026-10-05T00:15:00.000Z",
        invalidationReason: null,
      });
    }
    if (path === "/api/me/step-up/challenges" && method === "POST") {
      return json({
        challengeId: "challenge-fixture",
        nonce: "n".repeat(43),
        expiresAt: "2026-10-05T00:05:00.000Z",
      });
    }
    if (path === "/api/me/step-up" && method === "POST") {
      return json({
        token: "p".repeat(43),
        expiresAt: "2026-10-05T00:05:00.000Z",
      });
    }
    if (path.endsWith("/grant-admin") && method === "POST") {
      user.isInstanceAdmin = true;
      return json({ outcome: "granted" });
    }
    if (path.endsWith("/reset-mfa") && method === "POST") {
      user.twoFactorEnabled = false;
      return json({ reset: true, notificationEmailSent: true });
    }
    if (path.endsWith("/suspend") && method === "POST") {
      user.isSuspended = true;
      user.suspensionExpiresAt =
        (request.postDataJSON() as { expiresAt?: string }).expiresAt ?? null;
      return json({ suspended: true, expiresAt: user.suspensionExpiresAt });
    }
    if (path.endsWith("/unsuspend") && method === "POST") {
      user.isSuspended = false;
      user.suspensionExpiresAt = null;
      return json({ suspended: false });
    }
    if (path.endsWith("/sign-out") && method === "POST") {
      return json({ revokedSessions: 3 });
    }
    if (path.endsWith("/deactivate") && method === "POST") {
      return json(
        {
          pendingActionId: "pending-deactivation-1",
          action: "user_deactivation",
          confirmation: "typed_name_step_up",
          summary: { personId: "person-1", email: user.email },
          expiresAt: "2026-10-05T00:15:00.000Z",
          approveUrl:
            "/agent/settings/profile/pending-actions/pending-deactivation-1",
        },
        202,
      );
    }
    if (
      path === "/api/me/pending-actions/pending-deactivation-1/approve" &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as { typedName?: string };
      if (body.typedName !== user.email) {
        return json({ message: "confirmation_mismatch" }, 400);
      }
      pendingActionState = "executed";
      user.person.active = false;
      return json({ id: "pending-deactivation-1", state: "executed" });
    }
    if (
      path === "/api/me/pending-actions/pending-deactivation-1/cancel" &&
      method === "POST"
    ) {
      pendingActionState = "cancelled";
      return json({ id: "pending-deactivation-1", state: "cancelled" });
    }
    return json({ message: "Unexpected API request in this fixture" }, 500);
  });

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Operations" }).click();
  await page.getByRole("menuitem", { name: "Instance users" }).click();
  await expect(page).toHaveURL(/\/god-mode\/users$/);
  await expect(
    page.getByRole("heading", { name: "Instance users" }),
  ).toBeVisible();
  await page.getByLabel("Search users").fill("Taylor");
  const userRow = page
    .getByRole("row")
    .filter({ hasText: "taylor@example.test" });
  await expect(userRow).toBeVisible();
  await page.screenshot({
    path: "/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/screens/instance-users-directory.png",
    fullPage: true,
  });
  const userLink = page.getByRole("link", {
    name: "Open Taylor Staff, taylor@example.test",
  });
  await userLink.focus();
  await userLink.press("Enter");
  await expect(page).toHaveURL(/user=staff-user-1/);
  await expect(page.getByTestId("instance-user-details")).toBeVisible();
  await page.screenshot({
    path: "/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/screens/instance-user-details.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Grant instance admin" }).click();
  await page.getByLabel("Authenticator code").fill("123456");
  await page
    .getByRole("button", { name: "Grant instance administrator" })
    .click();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Instance administrator access granted",
  );

  await page.getByRole("button", { name: "Reset MFA" }).click();
  await page
    .getByLabel("Identity verification note")
    .fill("Verified by support call");
  await page.getByLabel("Authenticator code").fill("123456");
  await page
    .getByRole("button", { name: "Reset authenticator factor" })
    .click();
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "authenticator factor was reset",
  );

  await page.getByRole("button", { name: "Suspend account" }).click();
  await page.getByLabel("Reason (optional)").fill("Security review");
  await page.getByLabel("Expiry (optional)").fill("2030-01-01T12:00");
  await page.getByRole("button", { name: "Suspend account" }).last().click();
  await expect(page.getByText("Suspended", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Account suspended");

  await page.getByRole("button", { name: "Unsuspend account" }).click();
  await page.getByRole("button", { name: "Unsuspend account" }).last().click();
  await expect(page.getByText("Suspended", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Account suspension cleared",
  );

  await page.getByRole("button", { name: "Sign out all sessions" }).click();
  await page.getByRole("button", { name: "Sign out sessions" }).click();
  await expect(page.getByTestId("instance-user-details")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "All current sessions for this account were signed out",
  );
  await page.getByRole("button", { name: "Deactivate person" }).click();
  await page
    .getByRole("button", { name: "Request person deactivation" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "The account is unchanged until approval",
  );
  await page.getByRole("link", { name: "Review pending approval" }).click();
  await expect(
    page.getByRole("heading", { name: "Approve person deactivation" }),
  ).toBeVisible();
  await page.goto("/agent/settings/profile/pending-actions");
  await expect(
    page.getByRole("heading", { name: "My pending actions" }),
  ).toBeVisible();
  await expect(
    page.getByText("Deactivate person · taylor@example.test"),
  ).toBeVisible();
  await expect(page.getByText("Unknown action")).toBeVisible();
  await expect(page.getByText("future_unregistered_action")).toHaveCount(0);
  await expect(
    page.getByText("Expires", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/screens/pending-actions-list.png",
    fullPage: true,
  });
  await page.goto(
    "/agent/settings/profile/pending-actions/pending-deactivation-1",
  );
  await expect(
    page.getByRole("heading", { name: "Approve person deactivation" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/screens/pending-action-deactivation-approval.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("definition").filter({ hasText: "taylor@example.test" }),
  ).toBeVisible();
  await page
    .getByLabel("Type the exact current email")
    .fill("old@example.test");
  await page.getByLabel("Authenticator code").fill("123456");
  await expect(
    page.getByRole("button", { name: "Approve and deactivate" }),
  ).toBeDisabled();
  await page
    .getByLabel("Type the exact current email")
    .fill("taylor@example.test");
  const userListReadsBeforeApproval = received.filter(
    (entry) => entry === "GET /api/instance/users",
  ).length;
  await page.getByRole("button", { name: "Approve and deactivate" }).click();
  await expect(page.getByRole("status")).toContainText(
    "The approved deactivation completed",
  );
  expect(received).toContain("GET /api/instance/users");
  await page.getByRole("link", { name: "Open Users" }).click();
  await expect(page).toHaveURL(/\/god-mode\/users$/);
  await page.goto("/god-mode/users?user=staff-user-1");
  await expect(page).toHaveURL(/user=staff-user-1/);
  await expect(
    page.getByTestId("instance-user-details").getByText("Inactive", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    received.filter((entry) => entry === "GET /api/instance/users").length,
  ).toBeGreaterThan(userListReadsBeforeApproval);
  expect(received).toContain(
    "POST /api/instance/users/staff-user-1/deactivate",
  );
  expect(received).toContain(
    "GET /api/me/pending-actions/pending-deactivation-1",
  );
  expect(received).toContain(
    "POST /api/me/pending-actions/pending-deactivation-1/approve",
  );
  expect(received).toContain("GET /api/notification");
  expect(received).toContain(
    "POST /api/instance/users/staff-user-1/grant-admin",
  );
  expect(received).toContain("POST /api/instance/users/staff-user-1/reset-mfa");
  expect(received).toContain("POST /api/instance/users/staff-user-1/suspend");
  expect(received).toContain("POST /api/instance/users/staff-user-1/unsuspend");
  expect(received).toContain("POST /api/instance/users/staff-user-1/sign-out");
});
