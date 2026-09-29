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
  const stories = Object.freeze(
    Object.values(index.entries)
      .filter((entry) => entry.type === "story")
      .sort((left, right) => left.id.localeCompare(right.id)),
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
      });
  }

  console.log(`G8 Storybook screenshot coverage: ${stories.length} stories.`);
});
