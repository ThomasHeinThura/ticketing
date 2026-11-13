import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import {
  DEFAULT_RESOLVED_FEATURES,
  installPerformanceApiFixture,
} from "./helpers/g11-performance-fixture";

/**
 * UAT re-audit (release d35d165), against the mocked API. The fixture's role holds none of
 * `workspace:manage_settings`, `time_entry:manage_rates` or `time_entry:create`, and the
 * service catalogue is off, so these are the "reached by URL only" screens the re-audit found:
 * each must show one access or off notice, never send the request the server would refuse, and
 * keep exactly one h1, one main and a named navigation landmark. Light and dark screenshots are
 * kept in the test output folder as browser evidence.
 */

async function shot(page: Page, name: string) {
  // The app's own theme preference decides light or dark, not only the OS setting.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem(
        "user-preferences",
        JSON.stringify({ state: { theme: value }, version: 0 }),
      );
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(value);
    }, theme);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: test.info().outputPath(`${name}-${theme}.png`),
      fullPage: false,
    });
  }
}

/** Every /api request the page sends, so a spec can prove a refused read was never asked. */
function recordApiPaths(page: Page) {
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) paths.push(url.pathname);
  });
  return paths;
}

const deniedSettings = [
  {
    url: "/dashboard/settings/workspace/automations",
    refused: /\/api\/workspaces\/[^/]+\/automations/u,
    name: "automations",
  },
  {
    url: "/dashboard/settings/workspace/time-activities",
    refused: /\/api\/(time-activities|time-settings|available-hours)/u,
    name: "time-activities",
  },
  {
    url: "/dashboard/settings/workspace/rates",
    refused: /\/api\/(rates|time-entries|cost-types)/u,
    name: "rates",
  },
  {
    url: "/dashboard/settings/workspace/states",
    refused: /\/state-templates/u,
    name: "states",
  },
];

test.describe("settings opened by URL without the capability", () => {
  for (const setting of deniedSettings) {
    test(`${setting.name}: one access notice, no refused request, one h1`, async ({
      page,
    }) => {
      await installPerformanceApiFixture(page);
      const paths = recordApiPaths(page);
      await page.goto(setting.url);
      await expect(page.getByTestId("settings-access-denied")).toHaveCount(1);
      await expect(page.getByRole("button", { name: /retry/iu })).toHaveCount(
        0,
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Workspace" }),
      ).toBeVisible();
      expect(paths.filter((p) => setting.refused.test(p))).toEqual([]);
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      await shot(page, `settings-${setting.name}`);
    });
  }
});

test("timesheet without log-time shows the permission notice, not Retry", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const paths = recordApiPaths(page);
  await page.goto("/agent/timesheet");
  await expect(
    page.getByRole("heading", { name: "You don't have access", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /retry/iu })).toHaveCount(0);
  expect(paths.filter((p) => p.startsWith("/api/time-"))).toEqual([]);
  await shot(page, "timesheet-denied");
});

test("service catalogue off: one off state, no create or search, no 409 request", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  const paths = recordApiPaths(page);
  await page.goto("/agent/service-management/services");
  await expect(page.getByTestId("service-catalogue-off")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /^New service/iu }),
  ).toHaveCount(0);
  await expect(page.locator("search")).toHaveCount(0);
  expect(paths).not.toContain("/api/services");
  await shot(page, "services-off");

  await page.goto("/agent/service-management/announcements");
  await expect(page.getByTestId("service-catalogue-off")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "New announcement" }),
  ).toHaveCount(0);
  expect(paths).not.toContain("/api/announcements");
  await shot(page, "announcements-off");
});

test("agent shell: named sidebar navigation, one main, projects h1 and named progress bars", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto("/agent");
  await expect(page.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const bar of await page.getByRole("progressbar").all())
    await expect(bar).toHaveAccessibleName(/completion/u);
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
  await shot(page, "agent-projects");
});

/**
 * WCAG 2.4.1 bypass blocks: from page load the first Tab stop is the shell's skip link, shown on
 * focus, and Enter moves focus into the page's one `main` without a hash in the URL.
 */
// Phone uses the services screen: at 390px the projects table on /agent scrolls sideways in a
// container that is not keyboard focusable (axe scrollable-region-focusable), a separate,
// pre-existing finding that this skip-link check does not cover.
for (const [viewportName, viewport, url] of [
  ["desktop", { width: 1280, height: 800 }, "/agent"],
  ["phone", { width: 390, height: 844 }, "/agent/service-management/services"],
] as const) {
  test(`agent skip link (${viewportName}): first Tab, then Enter focuses the one main @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installPerformanceApiFixture(page);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator("main, [role=main]")).toHaveCount(1);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    // Shown on focus: sr-only (clipped) until then, a fixed, unclipped box while focused.
    await expect(skip).toHaveCSS("position", "fixed");
    await expect(skip).toHaveCSS("clip-path", "none");
    // A padded box, not bare text (not-sr-only resets padding).
    await expect(skip).toHaveCSS("padding-left", "12px");
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add(value);
      }, theme);
      await expect(skip).toBeFocused();
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      await page.screenshot({
        path: test
          .info()
          .outputPath(`agent-skip-link-${viewportName}-${theme}.png`),
      });
    }
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(new URL(page.url()).hash).toBe("");
    await expect(skip).toHaveCSS("position", "absolute");
    await expect(skip).not.toHaveCSS("clip-path", "none");
    // The next Tab continues inside the page, past the sidebar.
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("main")),
      ),
    ).toBe(true);
  });
}

test("agent notifications menu owns only groups and items (axe aria-required-children)", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto("/agent");
  await page.getByRole("button", { name: "Notifications" }).first().click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("group", { name: "Notifications" }),
  ).toBeVisible();
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
  await shot(page, "agent-notifications-empty");
});

test("phone width: the access notice and the off state fit without horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installPerformanceApiFixture(page);
  for (const [url, testId, name] of [
    [
      "/dashboard/settings/workspace/automations",
      "settings-access-denied",
      "phone-automations",
    ],
    [
      "/agent/service-management/services",
      "service-catalogue-off",
      "phone-services-off",
    ],
  ] as const) {
    await page.goto(url);
    await expect(page.getByTestId(testId)).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, name);
  }
});

test("option popovers open as named dialogs (axe aria-dialog-name)", async ({
  page,
}) => {
  await installPerformanceApiFixture(page, { workflowCapabilities: true });
  await page.goto("/agent/work-items/WLP-1");
  const triggers = page.locator(
    '[aria-haspopup="dialog"][data-slot="popover-trigger"]',
  );
  await expect(triggers.first()).toBeVisible();
  await triggers.first().click();
  const dialog = page.locator('[data-slot="popover-popup"][role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAccessibleName("");
  expect(
    (await seriousOrCriticalViolations(page)).filter(
      ({ id }) => id === "aria-dialog-name",
    ),
  ).toEqual([]);
  await shot(page, "work-item-popover");
});

test("command palette opens as a named dialog with a named list (axe aria-dialog-name, aria-input-field-name)", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.goto("/agent/projects/WLP/work?layout=list");
  await page.getByTestId("create-work-item-trigger").focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+k" : "Control+k",
  );
  const dialog = page.locator('[data-slot="command-dialog-popup"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).not.toHaveAccessibleName("");
  const list = dialog.getByRole("listbox");
  await expect(list).toBeVisible();
  await expect(list).not.toHaveAccessibleName("");
  expect(
    (await seriousOrCriticalViolations(page)).filter(({ id }) =>
      ["aria-dialog-name", "aria-input-field-name"].includes(id),
    ),
  ).toEqual([]);
  await shot(page, "command-palette");
});

/**
 * Re-review: `/api/capabilities` failing (5xx, network, 404 for an unknown or unreachable
 * project) left these screens on "Checking your access" forever. They now show one error with
 * Retry, never the screen's own reads, and Retry recovers once the read succeeds.
 */
test.describe("settings when the capability read fails", () => {
  // The fixture role lacks `workspace:manage_settings` and `time_entry:create`, so once the
  // capability read succeeds each screen settles on its denial notice.
  for (const [url, name, width, settled] of [
    ["/dashboard/settings/workspace/workflows", "workflows", 1280, "Workflows"],
    ["/dashboard/settings/workspace/workflows", "workflows", 390, "Workflows"],
    [
      "/dashboard/settings/projects/project-g11/estimates",
      "estimates",
      1280,
      "Estimates",
    ],
    [
      "/dashboard/settings/projects/project-g11/estimates",
      "estimates",
      390,
      "Estimates",
    ],
    [
      "/dashboard/settings/projects/project-g11/budget",
      "budget",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/projects/project-g11/budget",
      "budget",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/rates",
      "rates",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/rates",
      "rates",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/time-activities",
      "time-activities",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/time-activities",
      "time-activities",
      390,
      "settings-access-denied",
    ],
    ["/agent/triage", "triage", 1280, "settings-access-denied"],
    ["/agent/triage", "triage", 390, "settings-access-denied"],
    [
      "/dashboard/settings/workspace/automations",
      "automations",
      1280,
      "settings-access-denied",
    ],
    ["/agent/timesheet", "timesheet", 1280, "settings-access-denied"],
    [
      "/dashboard/settings/workspace/states",
      "states",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/features",
      "workspace-features",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/features",
      "workspace-features",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/projects/project-g11/features",
      "project-features",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/projects/project-g11/features",
      "project-features",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/terminology",
      "terminology",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/terminology",
      "terminology",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/request-types",
      "request-types",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/request-types",
      "request-types",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/canned-responses",
      "canned-responses",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/canned-responses",
      "canned-responses",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/work-item-templates",
      "work-item-templates",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/work-item-templates",
      "work-item-templates",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/customer-invitations",
      "customer-invitations",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/customer-invitations",
      "customer-invitations",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/custom-fields/new",
      "custom-field",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/custom-fields/new",
      "custom-field",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/webhooks",
      "webhooks",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/webhooks",
      "webhooks",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/sla-policies/new",
      "sla-policy",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/sla-policies/new",
      "sla-policy",
      390,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/calendars/new",
      "calendar",
      1280,
      "settings-access-denied",
    ],
    [
      "/dashboard/settings/workspace/calendars/new",
      "calendar",
      390,
      "settings-access-denied",
    ],
  ] as const) {
    test(`${name} at ${width}: error with Retry, then recovers`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await installPerformanceApiFixture(page);
      // The parent SLA routes require the feature and read their viewer-readable list
      // before rendering Outlet; neither list is protected by the create capability.
      if (name === "sla-policy" || name === "calendar") {
        await page.route(
          /\/api\/(?:workspaces\/[^/]+\/)?features\/resolved/u,
          (route) =>
            route.fulfill({
              json: {
                features: DEFAULT_RESOLVED_FEATURES.map((feature) =>
                  feature.key === "feature.sla"
                    ? { ...feature, enabled: true }
                    : feature,
                ),
              },
            }),
        );
        await page.route(
          /\/api\/(?:service-calendars|sla-policies)(?:\?|$)/u,
          (route) => route.fulfill({ json: { data: [], nextCursor: null } }),
        );
      }
      let failing = true;
      let capabilityReads = 0;
      await page.route("**/api/capabilities**", (route) => {
        capabilityReads += 1;
        return failing
          ? route.fulfill({ status: 500, json: { message: "boom" } })
          : route.fallback();
      });
      const paths = recordApiPaths(page);
      await page.goto(url);
      const error = page.getByTestId("settings-access-error");
      await expect(error).toBeVisible({ timeout: 15_000 });
      await expect(error).toContainText("Could not check your access");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(
        paths.filter(
          (p) =>
            !p.endsWith("/resolved") &&
            /automations|rates|cost-types|submissions|state-templates|features$|terminology|request-types|canned-responses|work-item-templates|customer-invitations|custom-fields|webhooks|sla-policies\/|service-calendars\/|\/api\/time-/u.test(
              p,
            ),
        ),
      ).toEqual([]);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(await seriousOrCriticalViolations(page)).toEqual([]);
      await shot(page, `capabilities-error-${name}-${width}`);

      failing = false;
      const readsBeforeRetry = capabilityReads;
      await error.getByRole("button", { name: "Retry" }).click();
      const settledState = settled.startsWith("settings-")
        ? page.getByTestId(settled)
        : page.getByRole("heading", { level: 1, name: settled, exact: true });
      await expect(settledState).toBeVisible();
      await expect(error).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(capabilityReads).toBeGreaterThan(readsBeforeRetry);
      await shot(page, `capabilities-retried-${name}-${width}`);
    });
  }

  // #1038: a project id that is neither listed nor archived shows the shared project
  // not-found state instead of each settings panel failing on its own.
  test("unknown project features: shows the project not-found state", async ({
    page,
  }) => {
    await installPerformanceApiFixture(page);
    await page.route("**/api/capabilities?*projectId=bogus*", (route) =>
      route.fulfill({ status: 404, json: { message: "Project not found" } }),
    );
    await page.goto("/dashboard/settings/projects/bogus/features");
    await expect(page.getByTestId("project-not-found")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("settings-access-error")).toHaveCount(0);
    await expect(
      page.getByRole("status", { name: "Checking your access" }),
    ).toHaveCount(0);
    await shot(page, "capabilities-404-project-features");
  });
});

// These reads are viewer-readable; the server may refuse an individual resource before
// capabilities arrive. The refused response must not erase the page's heading.
for (const [url, refused, name] of [
  [
    "/dashboard/settings/projects/project-g11/general",
    /\/api\/project\/project-g11(?:\?|$)/u,
    "project-general",
  ],
  [
    "/dashboard/settings/workspace/general",
    /\/api\/workspace\/[^/]+(?:\?|$)/u,
    "workspace-general",
  ],
  ["/agent/views", /\/api\/views(?:\?|$)/u, "views"],
  [
    "/agent/views/refused-view",
    /\/api\/views\/refused-view(?:\?|$)/u,
    "saved-view",
  ],
  [
    "/dashboard/settings/workspace/sla-policies/refused-policy",
    /\/api\/sla-policies\/refused-policy(?:\?|$)/u,
    "sla-detail",
  ],
  [
    "/dashboard/settings/workspace/calendars/refused-calendar",
    /\/api\/service-calendars\/refused-calendar(?:\?|$)/u,
    "calendar-detail",
  ],
] as const) {
  for (const width of [1280, 390]) {
    test(`${name} at ${width}: early 403 keeps a heading through capability failure`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await installPerformanceApiFixture(page);
      await page.route(
        /\/api\/(?:workspaces\/[^/]+\/)?features\/resolved/u,
        (route) =>
          route.fulfill({
            json: {
              features: DEFAULT_RESOLVED_FEATURES.map((feature) =>
                feature.key === "feature.sla"
                  ? { ...feature, enabled: true }
                  : feature,
              ),
            },
          }),
      );
      await page.route(
        /\/api\/(?:service-calendars|sla-policies)(?:\?|$)/u,
        (route) => route.fulfill({ json: { data: [], nextCursor: null } }),
      );
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/capabilities**", async (route) => {
        await pending;
        await route.fulfill({ status: 500, json: { message: "Unavailable" } });
      });
      await page.route(refused, (route) =>
        route.fulfill({ status: 403, json: { message: "Forbidden" } }),
      );
      await page.goto(url);
      try {
        await expect(
          page.getByRole("status", { name: "Checking your access" }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      } finally {
        release();
      }
      const error = page.getByTestId("settings-access-error");
      await expect(error).toBeVisible({ timeout: 15_000 });
      await expect(error.getByRole("button", { name: "Retry" })).toBeEnabled();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.getByTestId("settings-access-denied")).toHaveCount(0);
    });
  }
}

// These screens use the catalogue/report response itself as the access answer.
for (const [url, answer, name, title, loading] of [
  [
    "/agent/service-management/announcements",
    /\/api\/service-catalogue\/status(?:\?|$)/u,
    "announcements",
    "Announcements",
    "Checking your access",
  ],
  [
    "/agent/reports",
    /\/api\/reports(?:\?|$)/u,
    "reports-index",
    "Reports",
    "Loading page",
  ],
  [
    "/agent/reports/throughput",
    /\/api\/reports\/throughput(?:\?|$)/u,
    "report-detail",
    "Throughput",
    "Loading page",
  ],
] as const) {
  for (const width of [1280, 390]) {
    test(`${name} at ${width}: access read keeps one heading, retries, then denies`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await installPerformanceApiFixture(page);
      await page.route(
        /\/api\/(?:workspaces\/[^/]+\/)?features\/resolved/u,
        (route) =>
          route.fulfill({
            json: {
              features: DEFAULT_RESOLVED_FEATURES.map((feature) =>
                feature.key === "feature.reports"
                  ? { ...feature, enabled: true }
                  : feature,
              ),
            },
          }),
      );
      if (name === "report-detail")
        await page.route(/\/api\/reports(?:\?|$)/u, (route) =>
          route.fulfill({ json: { data: [], meta: {} } }),
        );
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let forbidden = false;
      let reads = 0;
      await page.route(answer, async (route) => {
        reads += 1;
        await pending;
        await route.fulfill({
          status: forbidden ? 403 : 500,
          json: { message: forbidden ? "Forbidden" : "Unavailable" },
        });
      });
      // /views is shared with the shell navigation; the component matrix separately
      // proves that the Reports page does not start its saved-view read before access.
      const paths = recordApiPaths(page);
      await page.goto(url);
      try {
        await expect(page.getByRole("status", { name: loading })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      } finally {
        release();
      }
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeEnabled({ timeout: 15_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.locator("form")).toHaveCount(0);
      expect(
        paths.filter(
          (path) =>
            /\/api\/(?:announcements(?:\/|$)|reports\/)/u.test(path) &&
            !answer.test(path),
        ),
      ).toEqual([]);
      await shot(page, `read-access-error-${name}-${width}`);
      forbidden = true;
      const beforeRetry = reads;
      await retry.click();
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "You don't have access",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(retry).toHaveCount(0);
      expect(reads).toBeGreaterThan(beforeRetry);
      expect(
        paths.filter(
          (path) =>
            /\/api\/(?:announcements(?:\/|$)|reports\/)/u.test(path) &&
            !answer.test(path),
        ),
      ).toEqual([]);
      await shot(page, `read-access-denied-${name}-${width}`);
    });
  }
}
