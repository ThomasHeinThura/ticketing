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
    await trigger.hover();
    await wrapperRequest;
    await trigger.click();
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
