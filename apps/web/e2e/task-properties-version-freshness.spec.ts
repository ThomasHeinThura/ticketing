import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
  PROJECT_ID,
  WORK_ITEM_KEY,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const DETAIL_PATH = `/api/work-items/${WORK_ITEM_KEY}`;

const isDetailRequest = (url: string) =>
  new URL(url).pathname.replace(/\/+$/, "") === DETAIL_PATH;

/**
 * A stateful `GET/PATCH /api/work-items/WLP-1` in front of the shared G11 fixture: GET
 * answers the current row, PATCH answers 200 with the updated row only when `If-Match`
 * names the current version and 409 (`WorkItemVersionConflict`) otherwise, so a write
 * asserting a stale version fails the test.
 */
async function installVersionedWorkItem(page: Page) {
  const state = {
    current: {
      ...makeWorkItem(1),
      description: "Original description" as unknown,
      startDate: null as string | null,
    },
    writes: [] as Array<{
      ifMatch: string | undefined;
      body: Record<string, unknown>;
      status: number;
    }>,
  };
  await page.route(`**${DETAIL_PATH}`, async (route) => {
    const request = route.request();
    if (!isDetailRequest(request.url())) return route.fallback();
    if (request.method() === "GET")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.current),
      });
    if (request.method() !== "PATCH") return route.fallback();
    const body = request.postDataJSON() as Record<string, unknown>;
    const ifMatch = request.headers()["if-match"];
    const status = ifMatch === `"${state.current.version}"` ? 200 : 409;
    if (status === 200) {
      state.current = {
        ...state.current,
        ...body,
        version: state.current.version + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    state.writes.push({ ifMatch, body, status });
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        status === 200
          ? state.current
          : {
              message: "Version conflict",
              assertedVersion: Number(ifMatch?.replaceAll('"', "")),
              currentVersion: state.current.version,
            },
      ),
    });
  });
  return state;
}

test("a description edit refreshes the version used by an open start-date control", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // An empty date control opens the calendar on the current month: pin "today" inside
  // October 2026 so the day picked below is always on the grid (timers keep running).
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
  await installPerformanceApiFixture(page);
  const workItem = await installVersionedWorkItem(page);

  const initialRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      isDetailRequest(response.url()) &&
      response.ok(),
  );
  // The old Kaneo task link still lands on the canonical work-item detail.
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
  );
  await expect(page).toHaveURL(
    new RegExp(`/agent/work-items/${WORK_ITEM_KEY}$`),
  );
  await initialRead;

  const description = page
    .getByRole("region", { name: "Description", exact: true })
    .locator('[contenteditable="true"]');
  await expect(description).toBeVisible();
  await expect(description).toHaveText("Original description");
  await description.fill("Latest description");
  const descriptionWrite = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      isDetailRequest(response.url()) &&
      response.ok(),
  );
  // The save is flushed when the editor loses focus; the success refreshes the detail.
  const updatedRead = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      isDetailRequest(response.url()) &&
      response.ok(),
  );
  await description.press("Tab");
  await descriptionWrite;
  await updatedRead;
  expect(workItem.writes).toHaveLength(1);
  expect(workItem.writes[0]).toMatchObject({ ifMatch: '"1"', status: 200 });
  expect(JSON.stringify(workItem.writes[0].body.description)).toContain(
    "Latest description",
  );
  expect(workItem.current.version).toBe(2);

  await page.getByTestId("work-item-startDate-control").click();
  const calendar = page.getByRole("grid");
  await expect(calendar).toBeVisible();
  const dateWrite = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      isDetailRequest(response.url()),
  );
  await page
    .getByRole("button", { name: "Monday, October 12th, 2026" })
    .click();
  const writeResponse = await dateWrite;

  expect(writeResponse.status()).toBe(200);
  expect(workItem.writes).toHaveLength(2);
  expect(workItem.writes[1]).toMatchObject({ ifMatch: '"2"', status: 200 });
  // The canonical PATCH is partial: the date write names only the date, so it can never
  // carry (and overwrite with) a stale description.
  expect(Object.keys(workItem.writes[1].body)).toEqual(["startDate"]);
  expect(String(workItem.writes[1].body.startDate)).toMatch(/^2026-10-12T/);
  expect(JSON.stringify(workItem.current.description)).toContain(
    "Latest description",
  );
  expect(workItem.current.version).toBe(3);
  await expect(page.getByTestId("work-item-startDate-control")).toContainText(
    "Oct 12, 2026",
  );
  await page.screenshot({ path: testInfo.outputPath("fresh-start-date.png") });
});
