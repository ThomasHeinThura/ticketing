import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

test("a description edit refreshes the version used by an open start-date control", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installPerformanceApiFixture(page);

  let currentTask = {
    id: "legacy-task-1",
    projectId: PROJECT_ID,
    position: 0,
    number: 1,
    userId: null,
    assigneeId: null,
    assigneeName: null,
    title: "Seeded legacy task 1",
    description: "Original description",
    status: "backlog",
    priority: "no-priority",
    startDate: null as string | null,
    dueDate: null,
    createdAt: "2026-09-30T00:00:00.000Z",
    version: 1,
  };
  const fullTaskWrites: Array<{
    ifMatch: string | undefined;
    body: Record<string, unknown>;
    status: number;
  }> = [];

  await page.route("**/api/task/legacy-task-1", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentTask),
    });
  });
  await page.route("**/api/task/description/legacy-task-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as { description: string };
    currentTask = {
      ...currentTask,
      description: body.description,
      version: currentTask.version + 1,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(currentTask),
    });
  });
  await page.route("**/api/v2/task/legacy-task-1", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    const ifMatch = request.headers()["if-match"];
    const status = ifMatch === `"${currentTask.version}"` ? 200 : 409;
    if (status === 200) {
      currentTask = {
        ...currentTask,
        title: String(body.title),
        description: String(body.description),
        startDate: typeof body.startDate === "string" ? body.startDate : null,
        dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
        version: currentTask.version + 1,
      };
    }
    fullTaskWrites.push({ ifMatch, body, status });
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status === 200
          ? currentTask
          : {
              message: "Version conflict",
              assertedVersion: Number(ifMatch?.replaceAll('"', "")),
              currentVersion: currentTask.version,
            },
      ),
    });
  });

  const initialTask = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "GET" &&
      new URL(response.url()).pathname === "/api/task/legacy-task-1" &&
      response.ok()
    );
  });
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
  );
  await initialTask;

  const description = page
    .getByRole("region", { name: "Task description editor" })
    .locator('[contenteditable="true"]');
  await expect(description).toBeVisible();
  await description.fill("Latest description");
  const descriptionWrite = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PUT" &&
      new URL(response.url()).pathname ===
        "/api/task/description/legacy-task-1" &&
      response.ok()
    );
  });
  await description.press("Tab");
  await descriptionWrite;
  const updatedTaskRead = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "GET" &&
      new URL(response.url()).pathname === "/api/task/legacy-task-1" &&
      response.ok()
    );
  });
  await updatedTaskRead;
  expect(currentTask).toMatchObject({
    description: "Latest description",
    version: 2,
  });

  await page
    .getByRole("button", { name: "No date", exact: true })
    .first()
    .click();
  const calendar = page.getByRole("grid");
  await expect(calendar).toBeVisible();
  const fullTaskWrite = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PUT" &&
      new URL(response.url()).pathname === "/api/v2/task/legacy-task-1"
    );
  });
  await page
    .getByRole("button", { name: "Monday, October 12th, 2026" })
    .click();
  const writeResponse = await fullTaskWrite;

  expect(writeResponse.status()).toBe(200);
  expect(fullTaskWrites).toHaveLength(1);
  expect(fullTaskWrites[0]).toMatchObject({
    ifMatch: '"2"',
    status: 200,
    body: { description: "Latest description" },
  });
  expect(currentTask).toMatchObject({ version: 3 });
  await page.screenshot({ path: testInfo.outputPath("fresh-start-date.png") });
});
