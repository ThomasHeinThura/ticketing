import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

/**
 * Runs axe-core (WCAG 2.0/2.1 A and AA) on the page and returns the serious and critical
 * violations, matching the G4 gate. Empty means the page passes.
 */
export async function seriousOrCriticalViolations(page: Page) {
  await page.addScriptTag({ content: axeCoreSource });
  return page.evaluate(async () => {
    type BrowserAxe = {
      run: (
        context: Document,
        options: { runOnly: { type: "tag"; values: string[] } },
      ) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          nodes: Array<{ target: string[] }>;
        }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    const { violations } = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target.join(" ")),
      }));
  });
}
