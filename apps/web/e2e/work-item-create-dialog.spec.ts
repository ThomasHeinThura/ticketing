import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  WORK_LIST_PATH,
} from "./helpers/g11-performance-fixture";

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
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
});

test("create dialog opens while the list, wrapper, and form load independently", async ({
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

  let releaseWrapper!: () => void;
  let wrapperRequested!: () => void;
  let wrapperRequestCount = 0;
  const wrapperRequest = new Promise<void>((resolve) => {
    wrapperRequested = resolve;
  });
  const wrapperRelease = new Promise<void>((resolve) => {
    releaseWrapper = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-") &&
      !url.pathname.includes("-form-") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      wrapperRequestCount += 1;
      wrapperRequested();
      await wrapperRelease;
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
    await trigger.click();
    await wrapperRequest;
    expect(wrapperRequestCount).toBe(1);
    await expect(
      page.getByTestId("create-work-item-dialog-loading"),
    ).toBeVisible();
    releaseWrapper();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /create/i }),
    ).toBeVisible();
    await formRequest;
    await expect(dialog.locator('[aria-busy="true"]')).toBeVisible();
    expect(
      await page
        .locator("[data-testid=work-item-list-populated] tbody tr")
        .count(),
    ).toBe(0);

    releaseForm();
    await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  } finally {
    releaseWrapper();
    releaseForm();
    releaseList();
  }
});

test("a failed dialog intent preload keeps the shell available and reloads for recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installPerformanceApiFixture(page);

  let wrapperRequestCount = 0;
  await page.route(
    (url) =>
      url.pathname.includes("create-work-item-dialog-") &&
      !url.pathname.includes("-form-") &&
      url.pathname.endsWith(".js"),
    async (route) => {
      wrapperRequestCount += 1;
      if (wrapperRequestCount === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    },
  );

  await page.goto(WORK_LIST_PATH);
  const trigger = page.getByTestId("create-work-item-trigger");
  await expect(trigger).toBeVisible();
  const failedPreload = page.waitForEvent(
    "requestfailed",
    (request) =>
      request.url().includes("create-work-item-dialog-") &&
      !request.url().includes("-form-"),
  );
  await trigger.focus();
  await failedPreload;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await trigger.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: /tryAgain/ }).click();
  await expect(page.getByTestId("create-work-item-trigger")).toBeVisible();
  await page.getByTestId("create-work-item-trigger").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
  expect(wrapperRequestCount).toBe(2);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByTestId("create-work-item-trigger").focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("create-work-item-title")).toBeVisible();
});
