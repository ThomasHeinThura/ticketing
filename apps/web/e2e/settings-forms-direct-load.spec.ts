import { expect, type Page, test } from "@playwright/test";

// Issue #697: react-hook-form's reset(loadedValues) can leave registered inputs
// blank under the React Compiler. Each settings form below loads its persisted
// values after mount, so a direct page load must still show them in the inputs.

const workspaceId = "workspace-forms-e2e";
const projectId = "project-forms-e2e";
const now = "2026-10-13T00:00:00.000Z";

const capabilities = {
  manageProjects: true,
  createProjects: true,
  updateProjects: true,
  deleteProjects: true,
  updateTasks: true,
  createTasks: true,
  deleteTasks: true,
  assignTasks: true,
  createLabels: true,
  updateLabels: true,
  deleteLabels: true,
  manageWorkspace: true,
  deleteWorkspace: true,
  inviteUsers: true,
  manageTeam: true,
  removeMembers: true,
  manageServiceCalendars: true,
};

function json(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function mockBackend(page: Page) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api/auth/get-session")) {
      return route.fulfill(
        json({
          session: {
            id: "session-forms-e2e",
            userId: "user-forms-e2e",
            token: "session-token-forms-e2e",
            expiresAt: "2027-01-01T00:00:00.000Z",
            createdAt: now,
            updatedAt: now,
            activeOrganizationId: workspaceId,
          },
          user: {
            id: "user-forms-e2e",
            name: "Persisted Person",
            email: "persisted.person@example.test",
            emailVerified: true,
            image: null,
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
    }
    if (path === "/api/workspace") {
      return route.fulfill(
        json([
          {
            id: workspaceId,
            name: "Persisted Workspace",
            slug: "persisted",
            logo: null,
            description: "Persisted workspace description",
            createdAt: now,
            role: "owner",
          },
        ]),
      );
    }
    if (path === `/api/workspace/${workspaceId}`) {
      return route.fulfill(
        json({
          id: workspaceId,
          name: "Persisted Workspace",
          slug: "persisted",
          logo: null,
          description: "Persisted workspace description",
          createdAt: now,
          members: [{ id: "user-forms-e2e", role: "owner" }],
        }),
      );
    }
    if (path.endsWith("/members")) {
      return route.fulfill(json([{ id: "user-forms-e2e", role: "owner" }]));
    }
    if (path.endsWith("/api/capabilities")) {
      return route.fulfill(json(capabilities));
    }
    if (path.endsWith("/api/me/csrf-token")) {
      return route.fulfill(json({ token: "e2e", expiresAt: "2027-01-01" }));
    }
    if (path === `/api/task/tasks/${projectId}`) {
      return route.fulfill(
        json({
          data: {
            id: projectId,
            workspaceId,
            name: "Persisted Project",
            slug: "PERSIST",
            description: "Persisted project description",
            icon: "Layout",
            createdAt: now,
            updatedAt: now,
            columns: [],
            archivedTasks: [],
            plannedTasks: [],
          },
        }),
      );
    }
    return route.fulfill(json([]));
  });
}

test.describe("settings forms show persisted values on direct load", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockBackend(page);
  });

  test("account information", async ({ page }) => {
    await page.goto("/dashboard/settings/account/information");
    await expect(page.locator('input[name="name"]')).toHaveValue(
      "Persisted Person",
    );
    await expect(page.locator('input[name="email"]')).toHaveValue(
      "persisted.person@example.test",
    );
  });

  test("workspace general", async ({ page }) => {
    await page.goto("/dashboard/settings/workspace/general");
    await expect(page.locator('input[name="name"]')).toHaveValue(
      "Persisted Workspace",
    );
    await expect(page.locator('input[name="description"]')).toHaveValue(
      "Persisted workspace description",
    );
  });

  test("project general", async ({ page }) => {
    await page.goto(`/dashboard/settings/projects/${projectId}/general`);
    await expect(page.locator('input[name="name"]')).toHaveValue(
      "Persisted Project",
    );
    await expect(page.locator('input[name="slug"]')).toHaveValue("PERSIST");
    await expect(page.locator('input[name="description"]')).toHaveValue(
      "Persisted project description",
    );
  });
});
