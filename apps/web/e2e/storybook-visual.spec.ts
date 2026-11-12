import { expect, test } from "@playwright/test";

type StorybookIndex = {
  entries: Record<string, { id: string; type: string }>;
};

test("every exported Storybook story has a visual baseline @visual", async ({
  page,
}) => {
  test.setTimeout(12 * 60 * 1000);
  const response = await fetch("http://127.0.0.1:6006/index.json");
  expect(response.ok).toBeTruthy();
  const index = (await response.json()) as StorybookIndex;
  Object.freeze(index.entries);
  Object.values(index.entries).forEach((entry) => {
    Object.freeze(entry);
  });
  Object.freeze(index);
  const stories = Object.freeze(
    Object.values(index.entries)
      .filter((entry) => entry.type === "story")
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((story) => Object.freeze(story)),
  );
  expect(stories.length).toBeGreaterThan(0);

  for (const story of stories) {
    await page.goto(
      `http://127.0.0.1:6006/iframe.html?id=${story.id}&viewMode=story`,
    );
    // Wait for the renderer to attach story content. Some modal stories put their only
    // visible surface in a portal because Storybook makes the canvas inert.
    await expect
      .poll(async () => {
        const storyRoot = page.locator("#storybook-root");
        const storyRendered = await storyRoot.evaluate(
          (root) =>
            root.childElementCount > 0 || Boolean(root.textContent?.trim()),
        );
        return storyRendered || (await page.getByRole("dialog").isVisible());
      })
      .toBe(true);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    await expect
      .soft(page, `Storybook story ${story.id}`)
      .toHaveScreenshot(`${story.id}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        scale: "css",
        maxDiffPixels: 0,
        threshold: 0,
        includeAA: true,
      });
  }

  console.log(`G8 Storybook screenshot coverage: ${stories.length} stories.`);
});

test("save feedback respects reduced motion and Enter guards @visual", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "http://127.0.0.1:6006/iframe.html?id=primitives-button--save-form&viewMode=story",
  );
  const input = page.getByLabel("Name");
  await input.press("Enter");
  await expect(page.locator("output")).toHaveText("1");
  await expect(page.locator("svg.animate-spin")).toBeVisible();
  await expect(page.locator("svg.animate-spin")).toHaveCSS(
    "animation-name",
    "none",
  );
  await input.press("Enter");
  await expect(page.locator("output")).toHaveText("1");
  await page.goto(
    "http://127.0.0.1:6006/iframe.html?id=primitives-toast--progress-controls-story&viewMode=story",
  );
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Counting", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.locator('[data-slot="toast-progress"]')).toHaveCSS(
    "display",
    "none",
  );
});

test("toast countdown follows pause, restart, persistence and expiry @visual", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(
    "http://127.0.0.1:6006/iframe.html?id=primitives-toast--progress-controls-story&viewMode=story",
  );
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Counting", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  const toast = page.getByText("Counting", { exact: true });
  const line = page.locator(".toast-progress-line");
  await expect(line).toBeVisible();
  const progress = () =>
    line.evaluate((el) => Number(el.getAnimations()[0]?.currentTime ?? 0));
  await page.waitForTimeout(400);
  const beforePause = await progress();
  await toast.hover();
  await expect(line).toHaveCSS("animation-play-state", "paused");
  const paused = await progress();
  await page.waitForTimeout(500);
  expect(Math.abs((await progress()) - paused)).toBeLessThan(80);
  await page.mouse.move(0, 0);
  await expect(line).toHaveCSS("animation-play-state", "running");
  await page.waitForTimeout(400);
  expect(await progress()).toBeGreaterThan(beforePause + 200);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(line).toHaveCSS("animation-duration", "6s");
  expect(await progress()).toBeLessThan(500);
  await page.getByRole("button", { name: "Persist", exact: true }).click();
  await expect(line).toHaveCount(0);
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(line).toBeVisible();
  const remaining = 4000 - (await progress());
  const start = Date.now();
  await expect(toast).toHaveCount(0, { timeout: 5000 });
  expect(Math.abs(Date.now() - start - remaining)).toBeLessThan(700);
});

test("icon and label stay aligned at both responsive widths @visual", async ({
  page,
}) => {
  for (const width of [375, 1200]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(
      "http://127.0.0.1:6006/iframe.html?id=primitives-button--save-with-icon&viewMode=story",
    );
    const buttons = page.getByRole("button", { name: "Add activity" });
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) {
      const alignment = await button.evaluate((element) => {
        const icon = element.querySelector("svg");
        const text = Array.from(icon?.parentElement?.childNodes ?? []).find(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        if (!icon || !text) throw new Error("Missing icon or label");
        const range = document.createRange();
        range.selectNodeContents(text);
        const iconBox = icon.getBoundingClientRect();
        const textBox = range.getBoundingClientRect();
        return {
          iconCenter: iconBox.y + iconBox.height / 2,
          textCenter: textBox.y + textBox.height / 2,
          iconRight: iconBox.right,
          textLeft: textBox.left,
        };
      });
      expect(
        Math.abs(alignment.iconCenter - alignment.textCenter),
      ).toBeLessThan(3);
      expect(alignment.iconRight).toBeLessThanOrEqual(alignment.textLeft);
    }
  }
});
