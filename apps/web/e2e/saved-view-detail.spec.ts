import { expect, test } from "@playwright/test";

const workspaceId = "workspace-saved-view-detail-e2e";
const savedView = {
  id: "view-detail-e2e",
  workspaceId,
  createdBy: "person-e2e",
  name: "High priority queue",
  scope: "workspace",
  scopeId: workspaceId,
  visibility: "private",
  sharedWithTeamId: null,
  layout: "list",
  query: {
    entity: "work_item",
    filter: { field: "priority", op: "eq", value: "high" },
    sort: [{ field: "key", direction: "asc" }],
  },
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  isPinned: true,
};

test("saved view URL runs for the current viewer and shows its count", async ({
  page,
}, testInfo) => {
  let searchBody: unknown;
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-e2e",
          userId: "user-saved-view-e2e",
          token: "session-token-e2e",
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: "2026-10-06T00:00:00.000Z",
          updatedAt: "2026-10-06T00:00:00.000Z",
          activeOrganizationId: workspaceId,
        },
        user: {
          id: "user-saved-view-e2e",
          name: "Saved View User",
          email: "saved-view-user@example.test",
          emailVerified: true,
          image: null,
          createdAt: "2026-10-06T00:00:00.000Z",
          updatedAt: "2026-10-06T00:00:00.000Z",
        },
      }),
    }),
  );
  await page.route("**/api/me/csrf-token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "set-cookie":
          "tdk_csrf_dev=e2e-csrf-token; Path=/; SameSite=Strict; HttpOnly",
      },
      body: JSON.stringify({
        token: "e2e-csrf-token",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    }),
  );
  await page.route("**/api/me/security/factors", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/api/config", (route) =>
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
  await page.route("**/api/workspace**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: workspaceId, name: "Support", slug: "support", role: "owner" },
      ]),
    }),
  );
  await page.route("**/api/project**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );
  await page.route("**/api/views**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/count")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ count: 7 }),
      });
      return;
    }
    if (url.pathname.endsWith(savedView.id)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedView),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([savedView]),
    });
  });
  await page.route("**/api/work-items/search", async (route) => {
    searchBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 7 },
      }),
    });
  });

  await page.goto(
    `/agent/views/${savedView.id}?workspaceId=${workspaceId}&scope=workspace&scopeId=${workspaceId}&layout=list&filter=priority%3Ahigh&sort=key&dir=asc`,
  );
  await expect(
    page.getByRole("heading", { name: "High priority queue", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("7 matching work items")).toBeVisible();
  await expect
    .poll(() => searchBody)
    .toMatchObject({
      workspaceId,
      query: {
        entity: "work_item",
        filter: { field: "priority", op: "eq", value: "high" },
        sort: [{ field: "key", order: "asc" }],
      },
    });
  await page.screenshot({
    path: testInfo.outputPath("saved-view-detail.png"),
    fullPage: true,
  });
});
