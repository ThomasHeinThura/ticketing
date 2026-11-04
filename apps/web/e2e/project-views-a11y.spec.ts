import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, type Route, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  PROJECT,
  PROJECT_ID,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";
import { installProjectOverviewFixture } from "./helpers/project-overview-fixture";

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
  // P4R1-M2: Calendar and Gantt render only while feature.calendar /
  // feature.timeline resolve on (GET /api/features/resolved?project=); an
  // unanswered read fails closed to the feature-off state.
  await page.route("**/api/features/resolved**", (route) =>
    json(route, {
      features: ["feature.calendar", "feature.timeline"].map((key) => ({
        key,
        enabled: true,
        source: "project",
        locked: false,
      })),
    }),
  );
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
    if (name === "board") {
      await expect(page.getByTestId("work-item-board")).toBeVisible();
      await expect(
        page.getByText("Seeded work item 1", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("work-item-board-error")).toHaveCount(0);
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
    if (name === "calendar") {
      const viewport = page
        .getByRole("region")
        .locator('[data-slot="scroll-area-viewport"]');
      await viewport.focus();
      await expect(viewport).toBeFocused();
      await viewport.press("ArrowDown");
      await expect
        .poll(() => viewport.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    }
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}

// S3/S3b: the project Overview (both kinds) and its Prerequisites, Team and Documents tabs,
// on desktop and phone widths, light and dark. The scan waits for real content so it never
// passes on a skeleton, and the phone run also checks there is no horizontal page scroll.
const OVERVIEW_SCREENS = [
  {
    name: "overview",
    path: "/agent/projects/WLP",
    ready: "project-summary-panel",
    text: "Move first-line support onto TaskDesk",
  },
  {
    name: "prerequisites",
    path: "/agent/projects/WLP/prerequisites",
    ready: "project-prerequisite-row",
    text: "Customer VPN access",
  },
  {
    name: "team",
    path: "/agent/projects/WLP/team",
    ready: "project-stakeholder-row",
    text: "Mia Manager",
  },
  {
    name: "documents",
    path: "/agent/projects/WLP/documents",
    ready: "project-document-row",
    text: "Statement of work",
  },
] as const;

for (const screen of OVERVIEW_SCREENS)
  for (const kind of ["project", "managed_service"] as const)
    for (const [width, height, colorScheme] of [
      [1280, 720, "light"],
      [390, 844, "dark"],
    ] as const) {
      if (screen.name !== "overview" && kind === "managed_service") continue;
      test(`project ${screen.name} (${kind}, ${width}px, ${colorScheme}) has no serious or critical axe violations @a11y`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
        await mountProjectAdminApp(page);
        await installProjectOverviewFixture(page, PROJECT_ID, {
          project: { ...PROJECT, kind },
          kind,
        });
        await page.goto(screen.path);
        await expect(page.getByTestId(screen.ready).first()).toContainText(
          screen.text,
        );
        if (screen.name === "overview") {
          await expect(
            page.getByTestId("project-milestones-panel"),
          ).toContainText("Go-live");
          if (kind === "managed_service")
            await expect(
              page.getByTestId("project-service-levels-panel"),
            ).toContainText("Incident");
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
      });
    }

// U-15: the Documents register's add dialog (type select, description, customer-visible
// switch with its explanation), on desktop light and phone dark.
for (const [width, height, colorScheme] of [
  [1280, 720, "light"],
  [390, 844, "dark"],
] as const)
  test(`project documents add dialog (${width}px, ${colorScheme}) has no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await mountProjectAdminApp(page);
    await installProjectOverviewFixture(page, PROJECT_ID, { project: PROJECT });
    await page.goto("/agent/projects/WLP/documents");
    await expect(
      page.getByTestId("project-document-row").first(),
    ).toContainText("Statement of work");
    await page.getByRole("button", { name: "Add document" }).click();
    const dialog = page.getByRole("dialog", { name: "Add document" });
    await expect(
      dialog.getByRole("switch", { name: "Visible to customers" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeFocused();
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });

// U-14: the project crumb keeps its label and the view strip (all 11 views on) keeps the active
// or focused tab clear of its 24 px edge fade, on load and on every Tab press, at desktop and
// tablet widths. The fade only covers an edge that still has content to scroll to, so the
// required inset on each side is the smaller of 24 px and the distance left to scroll that way.
const STRIP_FADE_PX = 24;

async function mountAllProjectViews(page: Page) {
  await mountProjectAdminApp(page);
  await page.route("**/api/features/resolved**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify({
        features: [
          "feature.calendar",
          "feature.timeline",
          "feature.cycles",
          "feature.modules",
          "feature.pages",
        ].map((key) => ({
          key,
          enabled: true,
          source: "project",
          locked: false,
        })),
      }),
    }),
  );
  await installProjectOverviewFixture(page, PROJECT_ID, { project: PROJECT });
}

/** How far `selector`'s element sits inside the strip, against the fade it must clear. */
function stripInset(page: Page, selector: string) {
  return page.evaluate(
    ([selector, fade]) => {
      const tab = document.querySelector<HTMLElement>(selector);
      const viewport = tab?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (!tab || !viewport) return null;
      const tabBox = tab.getBoundingClientRect();
      const viewportBox = viewport.getBoundingClientRect();
      const maxScroll = viewport.scrollWidth - viewport.clientWidth;
      const left = tabBox.left - viewportBox.left;
      const right = viewportBox.right - tabBox.right;
      return {
        label: tab.textContent,
        clearOfFade:
          left >= Math.min(fade, viewport.scrollLeft) - 0.5 &&
          right >= Math.min(fade, maxScroll - viewport.scrollLeft) - 0.5,
        left: Math.round(left),
        right: Math.round(right),
      };
    },
    [selector, STRIP_FADE_PX] as const,
  );
}

/**
 * Boxes of the project header's crumbs, its view navigation (`navSelector`: the view strip at lg
 * and up, the project menu below), the left row and the actions.
 */
function headerGeometry(page: Page, navSelector = '[aria-label="Work items"]') {
  return page.evaluate((navSelector) => {
    const box = (element: Element | null | undefined) => {
      if (!element) throw new Error("header element missing");
      const { left, right, width } = element.getBoundingClientRect();
      return { left, right, width };
    };
    const header = document.querySelector("header");
    const nav = header?.querySelector(navSelector);
    let row = nav as HTMLElement | null | undefined;
    while (
      row?.parentElement &&
      !row.parentElement.classList.contains("justify-between")
    )
      row = row.parentElement;
    return {
      workspace: box(
        header?.querySelector('button[aria-label^="Overview: " i]'),
      ),
      project: box(
        header?.querySelector('button[aria-label^="Select project: " i]'),
      ),
      nav: box(nav),
      leftRow: box(row),
      actions: box(row?.nextElementSibling),
    };
  }, navSelector);
}

const STRIP_VIEWS = [
  ["board", "/agent/projects/WLP/work?layout=board", "Work items"],
  ["prerequisites", "/agent/projects/WLP/prerequisites", "Prerequisites"],
  ["documents", "/agent/projects/WLP/documents", "Documents"],
  // Calendar also puts its search in the header's right-hand actions.
  ["calendar", `${PROJECT_VIEW}/calendar`, "Calendar"],
] as const;

/** Every view the fixture turns on, in the strip's order. */
const ALL_VIEW_LABELS = [
  "Overview",
  "Backlog",
  "Work items",
  "Calendar",
  "Timeline",
  "Cycles",
  "Modules",
  "Pages",
  "Prerequisites",
  "Team",
  "Documents",
];

// The strip shows from lg (1024 px) up; below lg the project menu replaces it (next loop).
for (const [name, path, activeLabel] of STRIP_VIEWS)
  for (const width of [1280, 1024])
    test(`project view strip keeps the ${name} tab clear of its fade at ${width}px @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await mountAllProjectViews(page);
      await page.goto(path);
      const header = page.locator("header");
      const strip = header.locator('[aria-label="Work items"]');
      const viewport = strip.locator('[data-slot="scroll-area-viewport"]');
      const tabs = viewport.getByRole("button");
      await expect(tabs).toHaveCount(11);
      await expect(
        viewport.getByRole("button", { name: activeLabel, exact: true }),
      ).toHaveAttribute("aria-current", "page");

      // The project crumb shows its whole label, not just the chevron.
      const crumb = header.getByRole("button", {
        name: "Select project: Performance fixture",
      });
      await expect(crumb).toContainText("Performance fixture");
      expect(
        await crumb
          .locator("span")
          .first()
          .evaluate(
            (label) =>
              label.clientWidth > 0 && label.scrollWidth <= label.clientWidth,
          ),
      ).toBe(true);

      // On load the active view is scrolled clear of the fade.
      await expect
        .poll(() => stripInset(page, 'header [aria-current="page"]'))
        .toMatchObject({ label: activeLabel, clearOfFade: true });
      // The overflowing strip fades its edges.
      expect(
        await viewport.evaluate(
          (element) => getComputedStyle(element).maskImage,
        ),
      ).not.toBe("none");
      // Nothing in the header overflows: the strip and its "More" menu stay inside the left
      // row, the row ends before the actions, and both crumbs keep their own room (no
      // overlap, and the workspace crumb stays a 24 px target).
      const geometry = await headerGeometry(page);
      expect(geometry.nav.right).toBeLessThanOrEqual(
        geometry.leftRow.right + 0.5,
      );
      const more = header.getByRole("button", { name: "More Project views" });
      if (await more.isVisible()) {
        const moreBox = await more.boundingBox();
        expect((moreBox?.x ?? 0) + (moreBox?.width ?? 0)).toBeLessThanOrEqual(
          geometry.leftRow.right + 0.5,
        );
      }
      expect(geometry.leftRow.right).toBeLessThanOrEqual(
        geometry.actions.left + 0.5,
      );
      expect(geometry.workspace.right).toBeLessThanOrEqual(
        geometry.project.left + 0.5,
      );
      expect(geometry.workspace.width).toBeGreaterThanOrEqual(24);

      // The strip's scroll frame is a Tab stop with a ring the fade's mask cannot clip.
      await crumb.focus();
      await page.keyboard.press("Tab");
      await expect(viewport).toBeFocused();
      expect(
        await viewport.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      expect(
        await strip.evaluate((element) => getComputedStyle(element).boxShadow),
      ).not.toBe("none");

      // Every tab is clear of the fade as keyboard focus reaches it.
      for (let index = 0; index < 11; index += 1) {
        await page.keyboard.press("Tab");
        await expect(tabs.nth(index)).toBeFocused();
        await expect
          .poll(() => stripInset(page, "header :focus"))
          .toMatchObject({ clearOfFade: true });
      }

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });

// Below lg the header has no room for the strip: the project menu replaces it, lists every
// view and marks the current one, and the header still fits.
for (const [name, path, activeLabel] of STRIP_VIEWS)
  for (const width of [960, 900, 800, 768])
    test(`project menu replaces the view strip on the ${name} view at ${width}px @a11y`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await mountAllProjectViews(page);
      await page.goto(path);
      const header = page.locator("header");
      const menu = header.getByRole("button", { name: "Project navigation" });
      await expect(menu).toBeVisible();
      await expect(header.locator('[aria-label="Work items"]')).toBeHidden();

      // The project crumb shows its whole label, not just the chevron.
      const crumb = header.getByRole("button", {
        name: "Select project: Performance fixture",
      });
      await expect(crumb).toContainText("Performance fixture");
      expect(
        await crumb
          .locator("span")
          .first()
          .evaluate(
            (label) =>
              label.clientWidth > 0 && label.scrollWidth <= label.clientWidth,
          ),
      ).toBe(true);

      // Nothing in the header overflows: the menu stays inside the left row, the row ends
      // before the actions, and both crumbs keep their own room.
      const geometry = await headerGeometry(
        page,
        'button[aria-label="Project navigation"]',
      );
      expect(geometry.nav.right).toBeLessThanOrEqual(
        geometry.leftRow.right + 0.5,
      );
      expect(geometry.leftRow.right).toBeLessThanOrEqual(
        geometry.actions.left + 0.5,
      );
      expect(geometry.workspace.right).toBeLessThanOrEqual(
        geometry.project.left + 0.5,
      );
      expect(geometry.workspace.width).toBeGreaterThanOrEqual(24);

      // The menu is the next Tab stop after the project crumb, with a visible focus ring, and
      // opens from the keyboard.
      await crumb.focus();
      await page.keyboard.press("Tab");
      await expect(menu).toBeFocused();
      expect(
        await menu.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await page.keyboard.press("Enter");
      const popup = page.locator('[data-slot="popover-popup"]');
      await expect(popup).toBeVisible();
      for (const label of ALL_VIEW_LABELS)
        await expect(
          popup.getByRole("button", { name: label, exact: true }),
        ).toBeVisible();
      await expect(
        popup.getByRole("button", { name: activeLabel, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(popup.locator('[aria-current="page"]')).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(popup).toBeHidden();

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });

// From md to below lg the Calendar search collapses to an icon button so the header fits;
// Cmd/Ctrl+F and the button open the same field, and lg and up keep the inline field.
for (const width of [768, 900, 1024])
  test(`calendar header search fits and stays reachable at ${width}px @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mountAllProjectViews(page);
    await page.goto(`${PROJECT_VIEW}/calendar`);
    const header = page.locator("header");
    await expect(header.locator('[aria-current="page"]')).toHaveText(
      "Calendar",
    );
    const trigger = header.getByRole("button", { name: "Search tickets..." });
    const field = page.getByRole("searchbox", { name: "Search tickets..." });

    if (width >= 1024) {
      await expect(trigger).toBeHidden();
      await expect(field).toBeVisible();
      await page.keyboard.press("ControlOrMeta+f");
      await expect(field).toBeFocused();
      return;
    }

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleDescription("");
    await expect(field).toBeHidden();
    await page.keyboard.press("ControlOrMeta+f");
    const popoverField = page
      .locator('[data-slot="popover-popup"]')
      .getByRole("searchbox", { name: "Search tickets..." });
    await expect(popoverField).toBeFocused();
    await popoverField.fill("fixture");
    await expect(page).toHaveURL(/[?&]q=fixture/);
    await page.keyboard.press("Escape");
    await expect(popoverField).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(
      trigger.getByTestId("project-task-search-active"),
    ).toBeAttached();
    await expect(trigger).toHaveAccessibleDescription("Search active");

    await page.reload();
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleDescription("Search active");

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(popoverField).toBeFocused();
    await expect(popoverField).toHaveValue("fixture");
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
    await popoverField.clear();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAccessibleDescription("");
    await expect(trigger.getByTestId("project-task-search-active")).toHaveCount(
      0,
    );
  });

test("mobile project navigation retains keyboard calendar and Timeline (Gantt) journeys @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountProjectAdminApp(page);
  await page.goto(`${PROJECT_VIEW}/calendar`);
  await page.getByRole("button", { name: "Project navigation" }).press("Enter");
  await page
    .getByRole("button", { name: "Timeline", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(new RegExp(`${PROJECT_VIEW}/gantt`));
  await expect(
    page.getByRole("heading", { name: "Gantt Timeline" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Project navigation" }).press("Enter");
  await page
    .getByRole("button", { name: "Calendar", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(new RegExp(`${PROJECT_VIEW}/calendar`));
  await expect(
    page
      .getByRole("main")
      .getByRole("region")
      .locator('[data-slot="scroll-area-viewport"]'),
  ).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});

test("board at 200% zoom has no serious or critical axe violations @a11y", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await mountProjectAdminApp(page);
  await page.goto(`${PROJECT_VIEW}/board`);
  await expect(page.getByTestId("work-item-board")).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});
