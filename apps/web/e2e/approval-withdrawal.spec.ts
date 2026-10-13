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
  defaultCommentVisibility: "internal",
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

type FixtureOptions = {
  /** Better Auth user role; "admin" is an instance-admin session. */
  role?: "admin" | "user";
  /** When set, withdrawal POSTs fail with this status (a stale or terminal approval). */
  withdrawStatus?: number;
};

async function installApprovalWithdrawalFixture(
  page: Page,
  { role = "user", withdrawStatus }: FixtureOptions = {},
) {
  let approval: Omit<typeof initialApproval, "state"> & { state: string } = {
    ...initialApproval,
  };
  const withdrawPaths: string[] = [];
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
          role,
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
    if (
      /\/api\/(admin\/)?approvals\/visual-approval\/withdraw$/.test(path) &&
      request.method() === "POST"
    ) {
      withdrawPaths.push(path);
      if (withdrawStatus) {
        // The server's view moves on: the approval is terminal by the time of the refetch.
        approval = { ...approval, state: "approved", canWithdraw: false };
        return route.fulfill({
          status: withdrawStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: "Approval is no longer pending" }),
        });
      }
      approval = { ...approval, state: "withdrawn", canWithdraw: false };
      return json(approval);
    }
    if (path.endsWith("/api/work-items/HELP-7/activity"))
      return json({
        data: [],
        page: { nextCursor: null, hasMore: false },
      });
    if (path.endsWith("/api/work-items/HELP-7")) return json(workItem);
    return json([]);
  });
  return withdrawPaths;
}

test("requester withdrawal uses the requester route and refreshes state", async ({
  page,
}, testInfo) => {
  const withdrawPaths = await installApprovalWithdrawalFixture(page);
  await page.goto("/agent/work-items/HELP-7");
  await expect(page.getByTestId("approval-visual-approval")).toBeVisible();
  await expect(page.getByText("Casey Review")).toBeVisible();

  const withdrawalResponse = page.waitForResponse((response) =>
    response.url().includes("/approvals/visual-approval/withdraw"),
  );
  await page.getByRole("button", { name: "Withdraw request" }).click();
  expect((await withdrawalResponse).status()).toBe(200);
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Withdraw request" }),
  ).toHaveCount(0);
  expect(withdrawPaths).toEqual(["/api/approvals/visual-approval/withdraw"]);
  await page.screenshot({
    path: testInfo.outputPath("approval-withdrawn.png"),
    fullPage: true,
  });
});

test("instance-admin withdrawal uses the admin route", async ({ page }) => {
  const withdrawPaths = await installApprovalWithdrawalFixture(page, {
    role: "admin",
  });
  await page.goto("/agent/work-items/HELP-7");
  await page.getByRole("button", { name: "Withdraw request" }).click();
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  expect(withdrawPaths).toEqual([
    "/api/admin/approvals/visual-approval/withdraw",
  ]);
});

test("a terminal-approval 409 explains itself and reloads the real state", async ({
  page,
}) => {
  await installApprovalWithdrawalFixture(page, { withdrawStatus: 409 });
  await page.goto("/agent/work-items/HELP-7");
  await page.getByRole("button", { name: "Withdraw request" }).click();
  await expect(page.getByTestId("approval-withdraw-error")).toContainText(
    "no longer pending",
  );
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Withdraw request" }),
  ).toHaveCount(0);
});
