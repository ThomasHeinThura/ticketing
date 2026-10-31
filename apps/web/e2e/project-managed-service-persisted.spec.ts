import {
  type APIResponse,
  expect,
  type Locator,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

// S5: the managed-service create flow, end to end against the real API and PostgreSQL.
// The catalogue entry opens the create modal preset to Managed service, the request body
// is the one `fetchers/project/create-project.ts` really sends, and the `/agent?kind=`
// filter reads the persisted kind. Screenshots cover three viewports in light and dark.

test.use({ trace: "off", video: "off", screenshot: "off" });

// The fixture signs up with a disposable password; a failure snapshot would print it.
test.afterEach(({ page: _page }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type JsonRecord = Record<string, unknown>;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;
const THEMES = ["light", "dark"] as const;

const weekdayWindows = Object.fromEntries(
  (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => [
    day,
    [{ from: 540, to: 1020 }],
  ]),
);

async function bodyAt(response: APIResponse, status: number) {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return (text ? JSON.parse(text) : {}) as JsonRecord;
}

function api(page: Page, origin: string) {
  const url = (path: string) => new URL(path, origin).toString();
  const csrf = async () => {
    const body = await bodyAt(
      await page.request.get(url("/api/me/csrf-token"), {
        headers: { Origin: origin },
      }),
      200,
    );
    return String(body.token);
  };
  return {
    get: async (path: string) =>
      bodyAt(
        await page.request.get(url(path), { headers: { Origin: origin } }),
        200,
      ),
    send: async (
      method: "POST" | "PATCH",
      path: string,
      data: JsonRecord,
      status = 200,
    ) => {
      const headers = { Origin: origin, "X-TaskDesk-CSRF": await csrf() };
      const response =
        method === "POST"
          ? await page.request.post(url(path), { headers, data })
          : await page.request.patch(url(path), { headers, data });
      return bodyAt(response, status);
    },
  };
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  // The agent app reads the persisted user preference (default dark), not the OS setting.
  await page.evaluate((value) => {
    const key = "user-preferences";
    const stored = JSON.parse(localStorage.getItem(key) ?? "{}") as {
      state?: JsonRecord;
      version?: number;
    };
    localStorage.setItem(
      key,
      JSON.stringify({
        ...stored,
        state: { ...(stored.state ?? {}), theme: value },
        version: stored.version ?? 0,
      }),
    );
  }, theme);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

// Chromium does not expose a streamed `fetch(Request)` body to Playwright, so the page
// records the exact JSON that the app hands to `fetch` for `POST /api/project`.
async function recordCreateProjectBodies(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as { __s5ProjectBodies: string[] };
    target.__s5ProjectBodies = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (method === "POST" && url.pathname === "/api/project") {
        target.__s5ProjectBodies.push(
          input instanceof Request
            ? await input.clone().text()
            : String(init?.body ?? ""),
        );
      }
      return original(input, init);
    };
  });
}

async function lastCreateProjectBody(page: Page) {
  const bodies = await page.evaluate(
    () =>
      (window as unknown as { __s5ProjectBodies: string[] }).__s5ProjectBodies,
  );
  const last = bodies.at(-1);
  if (!last) throw new Error("The app sent no POST /api/project body.");
  return JSON.parse(last) as JsonRecord;
}

const isCreateProject = (request: Request) =>
  request.method() === "POST" &&
  new URL(request.url()).pathname === "/api/project";

test("S5 creates managed services from the catalogue and filters them by kind on /agent", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  await withMfaCsrfApp(async ({ origin, email, password }) => {
    const at = (path: string) => new URL(path, origin).toString();
    await recordCreateProjectBodies(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(at("/auth/sign-up"));
    await page.getByLabel("Full name").fill("Disposable Service Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
    await page
      .getByLabel("Workspace name")
      .fill("Disposable Service Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    const workspaceId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (!workspaceId) throw new Error("No workspace id in the URL.");

    const client = api(page, origin);
    // Calendars are a `feature.sla` setting and the catalogue is `feature.service_catalogue`;
    // both are off by default, so the workspace owner turns them on.
    await client.send("PATCH", `/api/workspaces/${workspaceId}/features`, {
      changes: [
        { key: "feature.sla", enabled: true },
        { key: "feature.service_catalogue", enabled: true },
      ],
    });
    const calendar = await client.send("POST", "/api/service-calendars", {
      workspaceId,
      name: "Support coverage",
      timezone: "UTC",
      windows: weekdayWindows,
      holidays: [],
    });
    const calendarId = String(calendar.id);
    // A delivery project, so the kind filter has something to hide and to show.
    await client.send("POST", "/api/project", {
      workspaceId,
      name: "Website rebuild",
      slug: "WEB",
      icon: "Layout",
    });

    const cataloguePath = "/agent/service-management/services";
    const dialog = page.getByRole("dialog");
    const createButton = dialog.getByRole("button", { name: /^Create / });
    const managedRadio = dialog.getByRole("radio", { name: /Managed service/ });
    const supportLevel = dialog.getByRole("combobox", {
      name: "Support level",
    });
    const serviceCalendar = dialog.getByRole("combobox", {
      name: "Service calendar",
    });
    const openModal = async () => {
      await page.goto(at(cataloguePath));
      await page.getByTestId("create-managed-service").click();
      await expect(dialog).toBeVisible();
      await expect(managedRadio).toBeChecked();
    };
    const fillIdentity = async (name: string, key: string) => {
      await dialog.getByPlaceholder(/name$/i).fill(name);
      await dialog.locator("#project-key").fill(key);
    };

    // 1. No workspace default calendar: the default choice is refused before any request.
    let createRequests = 0;
    page.on("request", (request) => {
      if (isCreateProject(request)) createRequests += 1;
    });
    await openModal();
    await fillIdentity("Acme managed support", "ACME");
    await choose(page, supportLevel, "L2 support");
    await expect(page.getByTestId("project-calendar-no-default")).toBeVisible();
    await expect(createButton).toBeDisabled();
    expect(createRequests).toBe(0);

    // 2. An explicit calendar: the real body carries kind, support level and calendar id.
    await choose(page, serviceCalendar, "Support coverage");
    await expect(page.getByTestId("project-calendar-no-default")).toHaveCount(
      0,
    );
    const [explicitResponse] = await Promise.all([
      page.waitForResponse((response) => isCreateProject(response.request())),
      createButton.click(),
    ]);
    expect(await lastCreateProjectBody(page)).toEqual({
      name: "Acme managed support",
      slug: "ACME",
      icon: "Layout",
      workspaceId,
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendarId,
    });
    const explicit = (await bodyAt(explicitResponse, 200)) as { id: string };
    await expect(page).toHaveURL(new RegExp(`/${explicit.id}(?:/|\\?|$)`));
    expect(await client.get(`/api/project/${explicit.id}`)).toMatchObject({
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendarId,
    });

    // 3. With a workspace default, the default choice sends no calendar id at all, so the
    // API records an inherited calendar rather than a null override.
    const settings = await client.get(
      `/api/workspace/${workspaceId}/project-settings`,
    );
    await client.send(
      "PATCH",
      `/api/workspace/${workspaceId}/project-settings`,
      {
        expectedVersion: settings.version,
        defaultServiceCalendarId: calendarId,
      },
    );
    await openModal();
    await fillIdentity("Globex managed support", "GLOBEX");
    await choose(page, supportLevel, "L1 support");
    await expect(serviceCalendar).toContainText(
      "Default calendar (Support coverage)",
    );
    const [inheritResponse] = await Promise.all([
      page.waitForResponse((response) => isCreateProject(response.request())),
      createButton.click(),
    ]);
    const inheritBody = await lastCreateProjectBody(page);
    expect(inheritBody).toMatchObject({
      kind: "managed_service",
      supportLevel: "L1",
    });
    expect(inheritBody).not.toHaveProperty("serviceCalendarId");
    const inherited = (await bodyAt(inheritResponse, 200)) as { id: string };
    await expect(page).toHaveURL(new RegExp(`/${inherited.id}(?:/|\\?|$)`));
    expect(
      await client.get(`/api/projects/${inherited.id}/settings/inheritance`),
    ).toMatchObject({
      serviceCalendar: { mode: "inherit", effectiveId: calendarId },
    });

    // 4. The kind filter on /agent is URL state over the persisted kind.
    await page.goto(at("/agent?kind=managed_service"));
    const rows = page.getByTestId("g13-projects-content").getByRole("row");
    const acmeRow = rows.filter({ hasText: "Acme managed support" });
    await expect(acmeRow).toBeVisible();
    await expect(acmeRow.getByTestId("project-kind-badge")).toHaveText(
      "Managed service",
    );
    await expect(
      rows.filter({ hasText: "Globex managed support" }),
    ).toBeVisible();
    await expect(rows.filter({ hasText: "Website rebuild" })).toHaveCount(0);

    // "Delivery {{term_project_other}}": the project term is workspace terminology.
    const deliveryKind = /^Delivery /;
    await choose(page, page.getByTestId("project-kind-filter"), deliveryKind);
    await expect(page).toHaveURL(/\/agent\?kind=project$/);
    await expect(rows.filter({ hasText: "Website rebuild" })).toBeVisible();
    await expect(rows.filter({ hasText: "Acme managed support" })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("project-kind-badge")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("project-kind-filter")).toContainText(
      /Delivery /,
    );
    await expect(rows.filter({ hasText: "Acme managed support" })).toHaveCount(
      0,
    );

    // 5. Layout evidence: catalogue header, the modal and the filtered list at three
    // viewports in light and dark, with no horizontal page scroll.
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        const shot = (screen: string) =>
          page.screenshot({
            path: testInfo.outputPath(
              `s5-${screen}-${viewport.name}-${theme}.png`,
            ),
          });

        await page.goto(at(cataloguePath));
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        await expect(page.getByTestId("create-managed-service")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await shot("catalogue");

        await page.getByTestId("create-managed-service").click();
        await expect(dialog).toBeVisible();
        await choose(page, supportLevel, "L3 support");
        await expect(
          page.getByTestId("project-managed-service-fields"),
        ).toBeVisible();
        await expect(page.getByRole("listbox")).toHaveCount(0);
        // The fields scroll inside the dialog; the footer actions stay on screen.
        await expect(createButton).toBeInViewport();
        await expect(
          dialog.getByRole("button", { name: "Cancel" }),
        ).toBeInViewport();
        await shot("modal");
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toHaveCount(0);

        await page.goto(at("/agent?kind=managed_service"));
        await expect(acmeRow.getByTestId("project-kind-badge")).toBeVisible();
        await expect(
          page.getByTestId(
            viewport.name === "desktop"
              ? "project-kind-filter"
              : "project-kind-filter-mobile",
          ),
        ).toBeVisible();
        // The header actions stay inside the page width at every viewport.
        await expect(
          page.getByRole("button", { name: /^Create / }),
        ).toBeInViewport({ ratio: 1 });
        await expectNoHorizontalScroll(page);
        await shot("projects-filtered");
      }
    }
  });
});
