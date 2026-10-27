import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
} from "./helpers/g11-performance-fixture";

/**
 * GHSA-238p-pmpm-9mq7: KaTeX (bundled by Mermaid for `$$…$$` labels) must not inherit
 * `trust` from a polluted Object.prototype. Mock-backed counterpart of the SIT-only
 * `e2e-sit/mermaid-runtime.spec.ts` check, so the default e2e suite covers it on every run.
 */
const unsafeMath = String.raw`flowchart TD
  A["$$\href{javascript:alert(1)}{math probe}$$"] --> B["safe node"]
  click B "javascript:alert(2)" "unsafe click probe"`;
const ordinaryDiagram = `flowchart TD
  Start[Mock diagram] --> Review[Rendered in browser]`;
const description = `Mermaid security probe.\n\n\`\`\`mermaid\n${ordinaryDiagram}\n\`\`\`\n\n\`\`\`mermaid\n${unsafeMath}\n\`\`\``;

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
  await page.route("**/api/work-items/*/children*", (route) =>
    route.fulfill({
      json: {
        parent: { ...makeWorkItem(1), description },
        ancestors: [],
        data: [],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 0 },
        progress: { total: 0, completed: 0 },
      },
    }),
  );
  await page.route("**/api/work-items/*", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").at(-1);
    if (key === "WLP-1")
      return route.fulfill({ json: { ...makeWorkItem(1), description } });
    return route.fallback();
  });
}

test("a polluted Object.prototype.trust does not let KaTeX javascript: links survive Mermaid rendering", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.addInitScript(() => {
    Object.defineProperty(Object.prototype, "trust", {
      value: true,
      configurable: true,
      writable: true,
    });
  });
  await fixture(page);
  await page.goto("/agent/work-items/WLP-1");

  const region = page.getByRole("region", { name: "Description", exact: true });
  await expect(region).toBeVisible();
  // Both diagrams must actually render; an errored render would pass the href check vacuously.
  await expect
    .poll(() =>
      region.locator(".taskdesk-mermaid-preview[data-state='done']").count(),
    )
    .toBeGreaterThanOrEqual(2);

  const result = await page.evaluate(() => {
    const previews = [
      ...document.querySelectorAll<HTMLElement>(".taskdesk-mermaid-preview"),
    ];
    return {
      prototypePolluted:
        (Object.prototype as { trust?: unknown }).trust === true,
      unsafeDiagramRendered: previews.some((entry) =>
        entry.textContent?.includes("safe node"),
      ),
      javascriptHrefs: [...document.querySelectorAll("*")].filter((element) =>
        [
          element.getAttribute("href"),
          element.getAttribute("xlink:href"),
          element.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
        ].some((value) => /^\s*javascript:/iu.test(value ?? "")),
      ).length,
    };
  });
  expect(result.prototypePolluted).toBe(true);
  expect(result.unsafeDiagramRendered).toBe(true);
  expect(result.javascriptHrefs).toBe(0);

  // Activating the rendered math and the click target must not run script either.
  await region.getByText("safe node").first().click();
  const mathProbe = region.getByText("math probe");
  if ((await mathProbe.count()) > 0) await mathProbe.first().click();
  await expect(page).toHaveURL(/\/agent\/work-items\/WLP-1/u);
  expect(dialogs).toEqual([]);
});
