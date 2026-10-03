import { expect, type Page, test } from "@playwright/test";
import { createVersionedTaskFixture } from "./helpers/versioned-task-fixture";

const TASK_ID = "legacy-task-1";
const PROJECT_ID = "project-g11";
const INITIAL_TASK = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  position: 0,
  number: 1,
  userId: null,
  title: "Seeded legacy task 1",
  description: null,
  status: "backlog",
  priority: "no-priority",
  startDate: null,
  dueDate: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  version: 1,
};

async function mountVersionedTaskFixture(page: Page) {
  const fixture = createVersionedTaskFixture([INITIAL_TASK], {
    validStatuses: ["backlog", "in-progress", "review", "done"],
  });
  await page.route("**/api/**", async (route) => {
    const reply = fixture.handle(route.request());
    if (!reply) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Not found in the G11 browser fixture",
        }),
      });
      return;
    }
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });
  await page.goto("/auth/sign-in");
  return fixture;
}

test.describe("G11 versioned task API fixture in Chromium", () => {
  test("persists exact v2 task updates and rejects stale quoted versions", async ({
    page,
  }) => {
    const fixture = await mountVersionedTaskFixture(page);
    const result = await page.evaluate(async () => {
      const update = {
        title: "Seeded legacy task 1",
        description: "",
        priority: "no-priority",
        status: "in-progress",
        projectId: "project-g11",
        position: 0,
        userId: "",
      };
      const success = await fetch("/api/v2/task/legacy-task-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": '"1"' },
        body: JSON.stringify(update),
      });
      const successBody = await success.json();
      const stale = await fetch("/api/v2/task/legacy-task-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": '"1"' },
        body: JSON.stringify({ ...update, status: "review", position: 3 }),
      });
      return {
        successStatus: success.status,
        successBody,
        staleStatus: stale.status,
        staleBody: await stale.json(),
      };
    });

    expect(result.successStatus).toBe(200);
    expect(result.successBody).toMatchObject({
      id: TASK_ID,
      projectId: PROJECT_ID,
      version: 2,
      status: "in-progress",
      position: 0,
      userId: null,
    });
    expect(fixture.getTask(TASK_ID)).toMatchObject({
      version: 2,
      status: "in-progress",
      position: 0,
      userId: null,
    });
    expect(result.staleStatus).toBe(409);
    expect(result.staleBody).toMatchObject({
      assertedVersion: 1,
      currentVersion: 2,
    });
    expect(fixture.getTask(TASK_ID)).toMatchObject({
      version: 2,
      status: "in-progress",
      position: 0,
    });
  });

  test("requires a quoted version and leaves unknown v2 paths unhandled", async ({
    page,
  }) => {
    const fixture = await mountVersionedTaskFixture(page);
    const result = await page.evaluate(async () => {
      const update = {
        title: "Changed",
        description: "",
        priority: "no-priority",
        status: "in-progress",
        projectId: "project-g11",
        position: 0,
      };
      const missingVersion = await fetch("/api/v2/task/legacy-task-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const unquotedVersion = await fetch("/api/v2/task/legacy-task-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": "1" },
        body: JSON.stringify(update),
      });
      const unknownPath = await fetch("/api/v2/task/legacy-task-1/extra", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": '"1"' },
        body: JSON.stringify(update),
      });
      return {
        missingVersion: missingVersion.status,
        unquotedVersion: unquotedVersion.status,
        unknownPath: unknownPath.status,
      };
    });

    expect(result.missingVersion).toBe(400);
    expect(result.unquotedVersion).toBe(400);
    expect(result.unknownPath).toBe(404);
    expect(fixture.getTask(TASK_ID)).toEqual(INITIAL_TASK);
  });
});
