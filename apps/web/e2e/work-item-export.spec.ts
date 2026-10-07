import { copyFile, readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

test("work-list URL state drives CSV download and a denied export reports an error", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page, {
    apiOrigin: "http://127.0.0.1:4190",
  });

  const searchBodies: Record<string, unknown>[] = [];
  await page.route("**/api/work-items/search", async (route) => {
    searchBodies.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "export-row-1",
            projectId: "project-g11",
            workspaceId: "ws-g11",
            typeId: "type-g11",
            number: 1,
            key: "WLP-1",
            title: "Exported high-priority item",
            description: null,
            stateId: "state-g11",
            stateName: "Backlog",
            stateCategory: "backlog",
            priority: "high",
            assigneeId: null,
            assigneeName: null,
            requesterId: null,
            parentId: null,
            position: "1.0000000000",
            customerVisibility: "private",
            startDate: null,
            dueDate: "2026-10-20T00:00:00.000Z",
            archivedAt: null,
            deletedAt: null,
            version: 1,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        page: { hasMore: false, nextCursor: null },
        meta: { total: 1 },
      }),
    });
  });

  let exportStatus = 200;
  const exportBodies: Record<string, unknown>[] = [];
  await page.route("**/api/work-items/export", async (route) => {
    exportBodies.push(
      route.request().postDataJSON() as Record<string, unknown>,
    );
    if (exportStatus === 403)
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Missing work_item:export permission",
        }),
      });
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="work-items.csv"',
      },
      body: '"Key","Title","State","Assignee","Priority","Due date"\r\n"WLP-1","Exported high-priority item","Backlog","","high","2026-10-20"\r\n',
    });
  });

  await page.goto(
    `${WORK_LIST_PATH}&filter=priority%3Ahigh&sort=title&dir=desc`,
  );
  await expect(page).toHaveURL(/filter=priority%3Ahigh/u);
  await expect(page).toHaveURL(/sort=title/u);
  await expect(page).toHaveURL(/dir=desc/u);
  await expect(
    page.getByRole("textbox", { name: "Filter work items" }),
  ).toHaveValue("priority:high");
  await expect(page.getByText("Exported high-priority item")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("work-item-export-filtered-list.png"),
    fullPage: true,
  });
  await expect.poll(() => searchBodies.length).toBeGreaterThan(0);
  expect(searchBodies.at(-1)).toMatchObject({
    workspaceId: "ws-g11",
    query: {
      entity: "work_item",
      filter: {
        op: "and",
        clauses: [
          { field: "project", op: "eq", value: "WLP" },
          { field: "priority", op: "eq", value: "high" },
        ],
      },
      sort: [{ field: "title", order: "desc" }],
    },
  });

  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toBe("WLP-work-items.csv");
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("CSV download has no saved path");
  const downloadedCsv = await readFile(downloadPath, "utf8");
  expect(downloadedCsv).toContain('"WLP-1","Exported high-priority item"');
  expect(exportBodies).toHaveLength(1);
  expect(exportBodies[0]).toMatchObject({
    workspaceId: "ws-g11",
    query: {
      entity: "work_item",
      filter: {
        op: "and",
        clauses: [
          { field: "project", op: "eq", value: "WLP" },
          { field: "priority", op: "eq", value: "high" },
        ],
      },
      sort: [{ field: "title", order: "desc" }],
      columns: ["key", "title", "state", "assignee", "priority", "dueDate"],
    },
  });
  await copyFile(
    downloadPath,
    testInfo.outputPath(download.suggestedFilename()),
  );

  exportStatus = 403;
  await page.getByRole("button", { name: "Export CSV" }).click();
  await expect(
    page.locator('[data-slot="toast-title"]', {
      hasText: "Something went wrong",
    }),
  ).toBeVisible();
  expect(exportBodies).toHaveLength(2);
});
