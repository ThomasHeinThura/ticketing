import { expect, type Page, test } from "@playwright/test";

const workspace = {
  id: "visual-workspace",
  name: "Northstar Support",
  slug: "northstar-support",
  logo: null,
  description: "Approval withdrawal browser fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const project = {
  id: "visual-project",
  workspaceId: workspace.id,
  slug: "help",
  icon: null,
  name: "Help Desk",
  description: "Customer support work",
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 0,
  lastTaskNumber: 7,
  statistics: { completionPercentage: 25, totalTasks: 4, dueDate: null },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

const workItem = {
  id: "visual-item",
  projectId: project.id,
  workspaceId: workspace.id,
  typeId: "visual-type",
  number: 7,
  key: "HELP-7",
  title: "Customer cannot reset their password",
  description: "We sent a reset link, but it has expired.",
  stateId: "visual-state",
  stateName: "In progress",
  stateCategory: "started",
  priority: "high",
  assigneeId: null,
  assigneeName: null,
  requesterId: "visual-requester",
  parentId: null,
  position: "1.0000000000",
  customerVisibility: "private",
  startDate: "2026-09-01T00:00:00.000Z",
  dueDate: "2026-10-02T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
};

const initialApproval = {
  id: "visual-approval",
  workItemId: workItem.id,
  workItemKey: workItem.key,
  workItemTitle: workItem.title,
  transitionId: "visual-transition",
  kind: "customer",
  state: "pending",
  requester: { id: "visual-person", displayName: "Ada Example" },
  approver: { id: "visual-approver", displayName: "Casey Review" },
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-10-08T00:00:00.000Z",
  decidedAt: null,
  decisionNote: null,
  approverReachLost: false,
  canWithdraw: true,
};

async function installApprovalWithdrawalFixture(page: Page) {
  let approval: Omit<typeof initialApproval, "state"> & { state: string } = {
    ...initialApproval,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, headers?: Record<string, string>) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });

    if (path.endsWith("/api/auth/get-session")) {
      return json({
        session: {
          id: "visual-session",
          userId: "visual-user",
          activeOrganizationId: workspace.id,
          expiresAt: "2030-01-01T00:00:00.000Z",
          token: "visual-token",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        user: {
          id: "visual-user",
          name: "Ada Example",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          image: null,
        },
      });
    }
    if (path.endsWith("/api/config")) {
      return json({
        disableRegistration: true,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: true,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    }
    if (path.endsWith("/api/workspace")) return json([workspace]);
    if (path.endsWith("/api/project")) return json([project]);
    if (path.endsWith("/api/workspace/visual-workspace/members"))
      return json([
        {
          id: "visual-user",
          name: "Ada Example",
          email: "ada@example.test",
          image: null,
          role: "owner",
        },
      ]);
    if (path.endsWith("/api/capabilities")) return json({ createTasks: true });
    if (path.endsWith("/api/me/security/factors"))
      return json({ enabled: false, required: false, policyMode: "optional" });
    if (path.endsWith("/api/me/csrf-token"))
      return json(
        {
          token: "visual-csrf-token",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        {
          "set-cookie":
            "tdk_csrf_dev=visual-csrf-token; Path=/; SameSite=Strict; HttpOnly",
        },
      );
    if (path.endsWith("/api/work-items/HELP-7/approvals"))
      return json({ approvals: [approval] });
    if (path.endsWith("/api/work-items/HELP-7/activity"))
      return json({ data: [], page: { nextCursor: null, hasMore: false } });
    if (
      path.endsWith("/api/approvals/visual-approval/withdraw") &&
      request.method() === "POST"
    ) {
      approval = { ...approval, state: "withdrawn", canWithdraw: false };
      return json(approval);
    }
    if (path.endsWith("/api/work-items/HELP-7")) return json(workItem);
    return json([]);
  });
}

test("work-item approval withdrawal refreshes existing state in browser", async ({
  page,
}, testInfo) => {
  await installApprovalWithdrawalFixture(page);
  await page.goto("/agent/work-items/HELP-7");
  await expect(
    page.getByText("Customer approval for Casey Review"),
  ).toBeVisible();

  const withdrawalResponse = page.waitForResponse((response) =>
    response.url().includes("/approvals/visual-approval/withdraw"),
  );
  await page.getByRole("button", { name: "Withdraw request" }).click();
  expect((await withdrawalResponse).status()).toBe(200);
  await expect(page.getByText("withdrawn", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Withdraw request" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("approval-withdrawn.png"),
    fullPage: true,
  });
});
