import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

const PROJECT_A = {
  id: "project-g11",
  workspaceId: "ws-g11",
  slug: "WLP",
  name: "Performance fixture",
  description: null,
  icon: null,
  defaultCommentVisibility: "internal",
  createdAt: "2026-09-30T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 1,
  lastTaskNumber: 500,
  statistics: { completionPercentage: 0, totalTasks: 500, dueDate: null },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

const PROJECT_B = {
  ...PROJECT_A,
  id: "project-g11-b",
  slug: "WLP-B",
  name: "Second performance fixture",
};

test("work-list create dialog shell opens, closes, and reopens independently of the list", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await page.goto(WORK_LIST_PATH);

  const trigger = page.getByTestId("create-work-item-trigger");
  const dialog = page.getByRole("dialog");
  await expect(trigger).toBeVisible();
  await expect(
    page.locator("[data-testid=work-item-list-populated] tbody tr"),
  ).toHaveCount(500);
  await page.screenshot({
    path: testInfo.outputPath("work-list-initial.png"),
  });

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /create/i })).toBeVisible();
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveCount(1);
  await expect(dialog.locator('[data-slot="dialog-description"]')).toHaveCount(
    1,
  );
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("create-work-item-dialog.png"),
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
});

test("create dialog shell opens while the list and form load independently", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);

  let releaseList!: () => void;
  const listRelease = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.includes("work-items-panel") && url.pathname.endsWith(".js"),
    async (route) => {
      await listRelease;
      await route.continue();
    },
  );

  let releaseForm!: () => void;
  let formRequested!: () => void;
  const formRequest = new Promise<void>((resolve) => {
    formRequested = resolve;
  });
  const formRelease = new Promise<void>((resolve) => {
    releaseForm = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-form") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      formRequested();
      await formRelease;
      await route.continue();
    },
  );

  try {
    await page.goto(WORK_LIST_PATH);
    const trigger = page.getByTestId("create-work-item-trigger");
    await expect(trigger).toBeVisible();
    await expect(
      page.locator("[data-testid=work-item-list-populated] tbody tr"),
    ).toHaveCount(0);
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /create/i }),
    ).toBeVisible();
    await formRequest;
    await expect(
      dialog.getByTestId("create-work-item-dialog-loading"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid=work-item-list-populated] tbody tr"),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    expect(
      await page
        .locator("[data-testid=work-item-list-populated] tbody tr")
        .count(),
    ).toBe(0);

    releaseForm();
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  } finally {
    releaseForm();
    releaseList();
  }
});

test("a pending create intent is cancelled across project changes and browser back", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);
  await page.route(
    (url) =>
      url.pathname === "/api/project" && url.searchParams.has("workspaceId"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([PROJECT_A, PROJECT_B]),
      });
    },
  );
  await page.route(
    (url) => url.pathname === "/api/projects/project-g11-b/work-items",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          page: { hasMore: false, nextCursor: null },
          meta: {},
        }),
      });
    },
  );

  let releaseForm!: () => void;
  let formRequested!: () => void;
  const formRequest = new Promise<void>((resolve) => {
    formRequested = resolve;
  });
  const formRelease = new Promise<void>((resolve) => {
    releaseForm = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-form") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      formRequested();
      await formRelease;
      await route.continue();
    },
  );

  try {
    await page.goto(WORK_LIST_PATH);
    const triggerA = page.getByTestId("create-work-item-trigger");
    await expect(triggerA).toBeVisible();
    await triggerA.click();
    const dialogA = page.getByRole("dialog");
    await expect(dialogA).toBeVisible();
    await formRequest;
    await expect(
      dialogA.getByTestId("create-work-item-dialog-loading"),
    ).toBeVisible();

    await page.evaluate((nextPath) => {
      window.history.pushState({}, "", nextPath);
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: history.state }),
      );
    }, "/agent/projects/WLP-B/work?layout=list");

    await expect(page).toHaveURL(/\/agent\/projects\/WLP-B\/work/u);
    await expect(
      page.getByRole("heading", { name: /second performance fixture/i }),
    ).toBeVisible();
    await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    releaseForm();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByTestId("create-work-item-dialog-loading"),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("project-b-after-cancelled-create-intent.png"),
    });

    const triggerB = page.getByTestId("create-work-item-trigger");
    await triggerB.click();
    const dialogB = page.getByRole("dialog");
    await expect(dialogB).toBeVisible();
    await expect(dialogB.getByTestId("create-work-item-title")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("project-b-create-dialog-open.png"),
    });
    await page.keyboard.press("Escape");
    await expect(dialogB).toBeHidden();
    await expect(triggerB).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(/\/agent\/projects\/WLP\/work/u);
    await expect(
      page.getByRole("heading", { name: /performance fixture/i }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId("create-work-item-trigger").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    releaseForm();
  }
});

test("leaving the work route cancels a pending create intent on unmount", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);

  let releaseForm!: () => void;
  let formRequested!: () => void;
  const formRequest = new Promise<void>((resolve) => {
    formRequested = resolve;
  });
  const formRelease = new Promise<void>((resolve) => {
    releaseForm = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-form") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      formRequested();
      await formRelease;
      await route.continue();
    },
  );

  try {
    await page.goto(WORK_LIST_PATH);
    await page.getByTestId("create-work-item-trigger").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await formRequest;
    await page.evaluate((nextPath) => {
      window.history.pushState({}, "", nextPath);
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: history.state }),
      );
    }, "/agent/work-items/WLP-1");
    await expect(page).toHaveURL(/\/agent\/work-items\/WLP-1/u);
    releaseForm();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/agent\/work-items\/WLP-1/u);
  } finally {
    releaseForm();
  }
});

test("a failed form load shows an inline retry and recovers", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);

  let formRequestCount = 0;
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-form") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      formRequestCount += 1;
      if (formRequestCount === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    },
  );

  await page.goto(WORK_LIST_PATH);
  const trigger = page.getByTestId("create-work-item-trigger");
  await expect(trigger).toBeVisible();
  const failedDialogLoad = page.waitForEvent("requestfailed", (request) =>
    request.url().includes("create-work-item-dialog-form"),
  );
  await trigger.click();
  await failedDialogLoad;

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const retryButton = page.getByRole("button", { name: /try again/i });
  await expect(retryButton).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("create-dialog-load-error.png"),
  });
  const pageReload = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await retryButton.click();
  await pageReload;
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await page.getByTestId("create-work-item-trigger").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  expect(formRequestCount).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByTestId("create-work-item-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
});
