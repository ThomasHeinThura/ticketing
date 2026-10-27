import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
} from "./helpers/g11-performance-fixture";

async function fixture(page: Page) {
  await installPerformanceApiFixture(page);
  await page.route("**/api/work-items/*/approvals", (route) =>
    route.fulfill({ json: { approvals: [] } }),
  );
  await page.route("**/api/work-items/*/attachments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/work-items/*/activity*", (route) =>
    route.fulfill({
      json: { data: [], page: { hasMore: false, nextCursor: null } },
    }),
  );
  await page.route("**/api/work-items/*/sla", (route) =>
    route.fulfill({
      json: {
        key: "WLP-1",
        startedAt: "2026-10-21T00:00:00Z",
        evaluatedAt: "2026-10-21T00:00:00Z",
        metrics: ["first_response", "resolution"].map((metric) => ({
          metric,
          state: "none",
          dueAt: null,
          targetMinutes: null,
          consumedMinutes: 0,
          consumedPct: 0,
          remainingMinutes: null,
        })),
      },
    }),
  );
  let version = 1;
  let attached = false;
  let rejectNext = 0;
  const item = () => ({
    ...makeWorkItem(1),
    version,
    parentId: attached ? "work-item-2" : null,
  });
  await page.route("**/api/work-items/*", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").at(-1);
    if (key === "WLP-1") return route.fulfill({ json: item() });
    if (key === "WLP-2") return route.fulfill({ json: makeWorkItem(2) });
    return route.fallback();
  });
  await page.route("**/api/work-items/*/children*", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").at(-2);
    const isRoot = key === "WLP-2";
    return route.fulfill({
      json: {
        parent: isRoot ? makeWorkItem(2) : item(),
        ancestors: !isRoot && attached ? [makeWorkItem(2)] : [],
        data: isRoot && attached ? [{ ...item(), hasChildren: false }] : [],
        page: { nextCursor: null, hasMore: false },
        meta: { total: isRoot && attached ? 1 : 0 },
        progress: { total: isRoot && attached ? 1 : 0, completed: 0 },
      },
    });
  });
  await page.route("**/api/v2/work-items/WLP-1/parent", (route) => {
    if (rejectNext === 409) {
      rejectNext = 0;
      version += 1;
      return route.fulfill({
        status: 409,
        json: {
          message: "Version mismatch",
          assertedVersion: version - 1,
          currentVersion: version,
        },
      });
    }
    if (rejectNext === 422) {
      rejectNext = 0;
      return route.fulfill({
        status: 422,
        contentType: "text/plain",
        body: "The proposed parent would create a cycle",
      });
    }
    expect(route.request().headers()["if-match"]).toBe(`"${version}"`);
    attached = route.request().method() === "POST";
    if (attached)
      expect(route.request().postDataJSON()).toEqual({ parentKey: "WLP-2" });
    version += 1;
    return route.fulfill({ json: item() });
  });
  return {
    reject: (status: number) => {
      rejectNext = status;
    },
  };
}
async function choose(page: Page) {
  await page.getByRole("button", { name: "Parent", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Parent work item key" })
    .fill("WLP-2");
  await expect(
    page.getByText("WLP-2 · Seeded work item 2", { exact: true }),
  ).toBeVisible();
}

test("parent property attaches, survives reload and detaches through versioned calls", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/agent/work-items/WLP-1");
  await choose(page);
  await page
    .getByRole("textbox", { name: "Parent work item key" })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Parent", exact: true }),
  ).toContainText("WLP-2");
  // The new parent is the ancestor row of the hierarchy's tree mode.
  const hierarchy = page.getByTestId("work-item-hierarchy");
  await hierarchy
    .getByRole("button", { name: "Hierarchy", exact: true })
    .click();
  await expect(
    hierarchy.getByRole("link", {
      name: "WLP-2 · Seeded work item 2",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Parent", exact: true }),
  ).toContainText("WLP-2");
  // Approvals is a collapsed, URL-addressed disclosure in the properties panel.
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  await expect(page.getByText("No approvals on this work item")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("kaneo-parent-property.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Parent", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove parent", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Parent", exact: true }),
  ).toContainText("No parent");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Parent", exact: true }),
  ).toContainText("No parent");
});

test("parent property retains a rejected draft for conflict and cycle recovery", async ({
  page,
}) => {
  const controls = await fixture(page);
  await page.goto("/agent/work-items/WLP-1");
  await choose(page);
  controls.reject(409);
  await page.getByRole("button", { name: "Set parent", exact: true }).click();
  await expect(
    page.getByText(
      "This item changed. Review the latest version and try again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Parent work item key" }),
  ).toHaveValue("WLP-2");
  controls.reject(422);
  await page.getByRole("button", { name: "Set parent", exact: true }).click();
  await expect(
    page.getByText("The proposed parent would create a cycle"),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Parent work item key" }),
  ).toHaveValue("WLP-2");
  await page.getByRole("button", { name: "Set parent", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Parent", exact: true }),
  ).toContainText("WLP-2");
});
