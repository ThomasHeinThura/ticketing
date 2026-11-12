import { expect, type Page, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

async function installTimeSettings(page: Page) {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({ json: { logTime: true, manageWorkspaceSettings: true } }),
  );
  let writes = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/time-activities**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { data: [] } });
    if (route.request().method() !== "POST")
      throw new Error(
        `Unexpected time activity method: ${route.request().method()}`,
      );
    writes++;
    await pending;
    return route.fulfill({
      json: {
        id: "activity-1",
        workspaceId: "ws-g11",
        name: "Research",
        position: 0,
        archived: false,
      },
    });
  });
  await page.route("**/api/time-settings**", (route) =>
    route.fulfill({
      json: { backdateLimitDays: 14, canManage: true, project: null },
    }),
  );
  await page.route("**/api/available-hours**", (route) =>
    route.fulfill({
      json: {
        data: [],
        canManage: true,
        people: [],
        callerPersonId: "person-g11",
      },
    }),
  );
  return { writes: () => writes, release: () => release?.() };
}

for (const width of [375, 1200]) {
  test(`save icon alignment and Enter guard at ${width}px @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await installTimeSettings(page);
    await page.goto("/dashboard/settings/workspace/time-activities");
    const input = page.getByLabel("New activity");
    await input.fill("Research");
    const button = page.getByRole("button", { name: "Add activity" });
    await expect(button).toHaveCount(1);
    const alignment = await button.evaluate((element) => {
      const icon = element.querySelector("svg");
      const text = Array.from(icon?.parentElement?.childNodes ?? []).find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!icon || !text) throw new Error("Missing icon or label");
      const range = document.createRange();
      range.selectNodeContents(text);
      const i = icon.getBoundingClientRect();
      const t = range.getBoundingClientRect();
      return {
        vertical: Math.abs(i.y + i.height / 2 - t.y - t.height / 2),
        iconRight: i.right,
        textLeft: t.left,
      };
    });
    expect(alignment.vertical).toBeLessThan(3);
    expect(alignment.iconRight).toBeLessThanOrEqual(alignment.textLeft);
    await input.press("Enter");
    await expect.poll(fixture.writes).toBe(1);
    const spinner = button.locator("svg.animate-spin");
    await expect(spinner).toBeVisible();
    await expect(spinner).toHaveCSS("animation-name", "none");
    await expect(input).toBeDisabled();
    await input.locator("xpath=ancestor::form").evaluate((form) => {
      if (!(form instanceof HTMLFormElement)) throw new Error("Missing form");
      form.requestSubmit();
    });
    fixture.release();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    expect(fixture.writes()).toBe(1);
  });
}

for (const motion of ["reduce", "no-preference"] as const) {
  test(`success countdown respects ${motion} and hover @a11y`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await installTimeSettings(page);
    await page.goto("/dashboard/settings/workspace/time-activities");
    const input = page.getByLabel("Backdating limit (days)");
    await input.fill("15");
    await input.press("Enter");
    const track = page.locator('[data-slot="toast-progress"]');
    await expect(track).toHaveCount(1);
    if (motion === "reduce") {
      await expect(track).toHaveCSS("display", "none");
    } else {
      const line = track.locator(".toast-progress-line");
      await expect(line).toBeVisible();
      const toast = track.locator("xpath=..");
      await toast.hover();
      await expect
        .poll(() => line.evaluate((node) => node.getAnimations()[0]?.playState))
        .toBe("paused");
      const progress = () =>
        line.evaluate((node) => Number(node.getAnimations()[0]?.currentTime));
      const paused = await progress();
      await expect.poll(progress).toBe(paused);
      await page.mouse.move(0, 0);
      await expect
        .poll(() => line.evaluate((node) => node.getAnimations()[0]?.playState))
        .toBe("running");
      await expect.poll(progress).toBeGreaterThan(paused);
    }
  });
}
