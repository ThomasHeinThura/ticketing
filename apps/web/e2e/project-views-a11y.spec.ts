import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, type Route, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

const PROJECT_VIEW = `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}`;
const PROJECT_SETTINGS = `/dashboard/settings/projects/${PROJECT_ID}`;

// Issue #695: the sidebar menus, project-settings Select triggers, column
// editor rows/icon buttons and the mobile header navigation must expose valid
// lists and accessible names. The scan fails on any critical or serious axe
// violation, matching the G4 gate.
async function mountProjectAdminApp(page: Page) {
  await installPerformanceApiFixture(page);
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(body),
    });
  // Registered after the shared fixture, so these take precedence. Project
  // admin capabilities mount the sortable project list (drag-and-drop live
  // regions) and the editable column rows.
  await page.route("**/api/capabilities**", (route) =>
    json(route, {
      manageProjects: true,
      manageProjectSettings: true,
      createProjects: true,
      updateProjects: true,
      deleteProjects: true,
      updateTasks: true,
      createTasks: true,
      deleteTasks: true,
      assignTasks: true,
      createLabels: false,
      updateLabels: false,
      deleteLabels: false,
      manageWorkspace: false,
      deleteWorkspace: false,
      inviteUsers: false,
      manageTeam: false,
      removeMembers: false,
      createPublicComments: true,
      createInternalComments: true,
    }),
  );
  await page.route("**/api/invitation/pending", (route) => json(route, []));
  await page.route("**/api/notification**", (route) => json(route, []));
  await page.route("**/api/workflow-rule/**", (route) => json(route, []));
}

async function seriousOrCriticalViolations(page: Page) {
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
          nodes: Array<{ target: string[]; html: string }>;
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
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map(
          (n) => `${n.target.join(" ")} :: ${n.html.slice(0, 160)}`,
        ),
      }));
  });
}

for (const [name, path] of [
  ["board", `${PROJECT_VIEW}/board`],
  ["backlog", `${PROJECT_VIEW}/backlog`],
  ["calendar", `${PROJECT_VIEW}/calendar`],
  ["gantt", `${PROJECT_VIEW}/gantt`],
  ["project settings general", `${PROJECT_SETTINGS}/general`],
  ["project settings workflow", `${PROJECT_SETTINGS}/workflow`],
] as const) {
  test(`${name} has no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mountProjectAdminApp(page);
    await page.goto(path);
    if (path.includes("/settings/")) {
      await expect(
        page.locator('[data-slot="select-trigger"]').first(),
      ).toBeVisible();
    } else {
      // The sortable project list is only mounted for project editors.
      await expect(
        page.locator("li[data-taskdesk-sortable]", {
          hasText: "Performance fixture",
        }),
      ).toBeVisible();
    }
    // WCAG 2.5.3: the Select trigger name contains its visible text.
    if (name === "project settings general")
      await expect(
        page.getByRole("combobox", { name: /Project.*Performance fixture/ }),
      ).toBeVisible();
    if (name.endsWith("workflow"))
      await expect(
        page.locator('ul > li [data-slot="input"]').first(),
      ).toBeVisible();
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

test("board at 200% zoom has no serious or critical axe violations @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await mountProjectAdminApp(page);
  await page.goto(`${PROJECT_VIEW}/board`);
  await expect(page.getByTestId("g13-board-content")).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});
