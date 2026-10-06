import { expect, test } from "@playwright/test";

const workspaceId = "workspace-saved-view-e2e";
const savedView = {
  id: "view-delete-e2e",
  workspaceId,
  createdBy: "person-e2e",
  name: "Escalations",
  scope: "workspace",
  scopeId: workspaceId,
  visibility: "private",
  sharedWithTeamId: null,
  layout: "list",
  query: { entity: "work_item" },
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  isPinned: true,
};

test("saved view deletion requests enter the pending-action review flow", async ({
  page,
}, testInfo) => {
  let state = "pending";
  let requestCount = 0;
  let pendingActionId = "pending-view-delete-e2e";
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-e2e",
          userId: "user-e2e",
          token: "session-token-e2e",
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: "2026-10-06T00:00:00.000Z",
          updatedAt: "2026-10-06T00:00:00.000Z",
          activeOrganizationId: workspaceId,
        },
        user: {
          id: "user-e2e",
          name: "Saved View Admin",
          email: "saved-view-admin@example.test",
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
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: workspaceId, name: "Support", slug: "support", role: "owner" },
      ]),
    }),
  );
  await page.route("**/api/views**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([savedView]),
      });
      return;
    }
    if (request.method() === "DELETE") {
      requestCount += 1;
      pendingActionId = `pending-view-delete-${requestCount}-e2e`;
      state = "pending";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          pendingActionId,
          action: "delete",
          summary: { name: savedView.name },
          confirmation: "click",
          expiresAt: "2026-10-07T00:00:00.000Z",
          approveUrl: `/api/me/pending-actions/${pendingActionId}/approve`,
        }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route(
    "**/api/me/pending-actions/pending-view-delete-*-e2e**",
    async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: pendingActionId,
            action: "delete",
            origin: "web",
            targetType: "saved_view",
            targetIds: [savedView.id],
            summary: { name: savedView.name },
            confirmation: "click",
            state,
            createdAt: "2026-10-06T00:00:00.000Z",
            expiresAt: "2026-10-07T00:00:00.000Z",
            invalidationReason: null,
            decidedAt: null,
            executedAt: null,
            requestingKeyName: null,
          }),
        });
        return;
      }
      if (route.request().url().endsWith("/cancel")) {
        state = "cancelled";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
        return;
      }
      if (route.request().url().endsWith("/approve")) {
        state = "executed";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: pendingActionId, state }),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto("/agent/views?query=Escalations");
  await expect(
    page.getByRole("heading", { name: "Saved views" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Escalations" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saved-views-list.png") });
  await page.getByRole("button", { name: "Request deletion" }).click();
  await expect(page).toHaveURL(/pending-actions\/pending-view-delete-1-e2e/);
  await expect(page.getByText("Delete saved view: Escalations")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("saved-view-pending-action.png"),
  });
  await page.getByRole("button", { name: "Approve and execute" }).click();
  await expect(page.getByText("Saved view deletion approved.")).toBeVisible();

  await page.goto("/agent/views?query=Escalations");
  await page.getByRole("button", { name: "Request deletion" }).click();
  await expect(page).toHaveURL(/pending-actions\/pending-view-delete-2-e2e/);
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(
    page.getByText("The pending action was cancelled."),
  ).toBeVisible();
});
