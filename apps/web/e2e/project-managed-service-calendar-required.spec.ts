import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type APIResponse,
  expect,
  type Locator,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import { enrollFirstAdmin } from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

// Decision 4 November 2026: when no service calendar resolves for a new managed service,
// the create dialog asks for one and Create stays disabled until it is chosen, for an
// internal project and for a customer organisation alike. End to end against the real API and
// PostgreSQL, at 1280 and 375 in light and dark.

test.use({ trace: "off", video: "off", screenshot: "off" });

// The fixture signs up with a disposable password; a failure snapshot would print it.
test.afterEach(({ page: _page }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type JsonRecord = Record<string, unknown>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
type FixturePgClient = {
  connect(): Promise<void>;
  query(query: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
};
const { Client } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => FixturePgClient;
};

/**
 * Two active customer organisations, on the disposable database only (the instance
 * organisation API is outside this journey). Acme has no default for the workspace, and the
 * workspace has none, so nothing resolves for it. Globex's workspace default names the calendar.
 */
async function seedOrganisations(
  databaseUrl: string,
  workspaceId: string,
  calendarId: string,
) {
  const acmeId = `calendar-e2e-acme-${randomUUID()}`;
  const globexId = `calendar-e2e-globex-${randomUUID()}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO organisation (id, key, name) VALUES ($1, $2, 'Acme Corp'), ($3, $4, 'Globex')",
      [acmeId, `acme-${randomUUID()}`, globexId, `globex-${randomUUID()}`],
    );
    await client.query(
      "INSERT INTO organisation_project_default (organisation_id, workspace_id, service_calendar_id, sla_policy_id) VALUES ($1, $2, $3, NULL)",
      [globexId, workspaceId, calendarId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  return { acmeId, globexId };
}

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 812 },
] as const;
const THEMES = ["light", "dark"] as const;

const weekdayWindows = Object.fromEntries(
  (["mon", "tue", "wed", "thu", "fri"] as const).map((day) => [
    day,
    [{ from: 540, to: 1020 }],
  ]),
);

/** Reads a JSON body from an API call or a page response, asserting the status first. */
async function bodyAt(
  response: Pick<APIResponse, "status" | "text">,
  status: number,
) {
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
    send: async (method: "POST" | "PATCH", path: string, data: JsonRecord) => {
      const headers = { Origin: origin, "X-TaskDesk-CSRF": await csrf() };
      const response =
        method === "POST"
          ? await page.request.post(url(path), { headers, data })
          : await page.request.patch(url(path), { headers, data });
      return bodyAt(response, 200);
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

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const isCreateProject = (request: Request) =>
  request.method() === "POST" &&
  new URL(request.url()).pathname === "/api/project";

test("asks for a service calendar when none resolves, and creates with the chosen one", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(10_000);
  await withMfaCsrfApp(async (fixture) => {
    const { origin, email, password, databaseUrl, setupUrl } = fixture;
    const at = (path: string) => new URL(path, origin).toString();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(setupUrl);
    await page.getByLabel("Full name").fill("Disposable Calendar Admin");
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await enrollFirstAdmin(page, origin, password);
    await page
      .getByLabel("Workspace name")
      .fill("Disposable Calendar Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    const workspaceId = new URL(page.url()).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    if (!workspaceId) throw new Error("No workspace id in the URL.");

    // Calendars need `feature.sla`; the catalogue entry needs `feature.service_catalogue`.
    // The workspace has no default calendar, so nothing resolves for an internal service.
    const client = api(page, origin);
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
    const { acmeId } = await seedOrganisations(
      databaseUrl,
      workspaceId,
      calendarId,
    );

    const dialog = page.getByRole("dialog");
    const createButton = dialog.getByRole("button", { name: /^Create / });
    const supportLevel = dialog.getByRole("combobox", {
      name: "Support level",
    });
    const serviceCalendar = dialog.getByRole("combobox", {
      name: "Service calendar",
    });
    const organisation = dialog.getByRole("combobox", {
      name: "Customer organisation",
    });
    const hint = page.getByTestId("project-calendar-no-default");
    const expectCalendarRequired = async () => {
      await expect(serviceCalendar).toContainText("Choose a calendar");
      await expect(serviceCalendar).toHaveAttribute("aria-invalid", "true");
      await expect(hint).toHaveText(
        "No default service calendar applies here. Choose a calendar.",
      );
      await expect(createButton).toBeDisabled();
    };
    const fillManagedService = async (key: string) => {
      await dialog.getByPlaceholder(/name$/i).fill("Acme managed support");
      await dialog.locator("#project-key").fill(key);
      await choose(page, supportLevel, "L2 support");
    };
    const openModal = async () => {
      await page.goto(at("/agent/service-management/services"));
      await page.getByTestId("create-managed-service").click();
      await expect(dialog).toBeVisible();
    };

    let createRequests = 0;
    page.on("request", (request) => {
      if (isCreateProject(request)) createRequests += 1;
    });

    // Layout evidence of the "choose a calendar" state, with no request sent.
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await openModal();
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        await fillManagedService("ACME");
        await expect(organisation).toContainText("None (internal Project)");
        await expectCalendarRequired();
        await expect(createButton).toBeInViewport();
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: testInfo.outputPath(
            `calendar-required-${viewport.name}-${theme}.png`,
          ),
        });

        // The picker offers the real calendars and no "Default calendar" choice.
        await serviceCalendar.click();
        await expect(page.getByRole("option")).toHaveText(["Support coverage"]);
        await expect(page.getByRole("option")).toBeInViewport();
        // Let the popup's open transition finish so the evidence shows it settled.
        await page
          .getByRole("listbox")
          .evaluate((element) =>
            Promise.all(
              element
                .getAnimations({ subtree: true })
                .map((animation) => animation.finished),
            ).then(() => undefined),
          );
        await page.screenshot({
          path: testInfo.outputPath(
            `calendar-picker-${viewport.name}-${theme}.png`,
          ),
        });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("listbox")).toHaveCount(0);

        // The same state for a customer organisation that resolves no calendar.
        await choose(page, organisation, "Acme Corp");
        await expectCalendarRequired();
        await expect(createButton).toBeInViewport();
        await expectNoHorizontalScroll(page);
        await serviceCalendar.click();
        await expect(page.getByRole("option")).toHaveText(["Support coverage"]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("listbox")).toHaveCount(0);
        await serviceCalendar.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(
            `calendar-required-organisation-${viewport.name}-${theme}.png`,
          ),
        });
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toHaveCount(0);
      }
    }
    expect(createRequests).toBe(0);

    // Switching from an organisation that resolves nothing to one that resolves a default
    // enables Create with the inherited calendar; switching back disables it again.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModal();
    await fillManagedService(uniqueProjectKey());
    await choose(page, organisation, "Acme Corp");
    await expectCalendarRequired();
    await choose(page, organisation, "Globex");
    await expect(serviceCalendar).toContainText(
      "Default calendar (Support coverage)",
    );
    await expect(serviceCalendar).not.toHaveAttribute("aria-invalid");
    await expect(hint).toHaveCount(0);
    await expect(createButton).toBeEnabled();
    await choose(page, organisation, "Acme Corp");
    await expectCalendarRequired();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(createRequests).toBe(0);

    /** Chooses the calendar, creates, and returns the persisted project. */
    const createWithChosenCalendar = async () => {
      await expect(createButton).toBeDisabled();
      await choose(page, serviceCalendar, "Support coverage");
      await expect(hint).toHaveCount(0);
      await expect(createButton).toBeEnabled();
      const [response] = await Promise.all([
        page.waitForResponse((candidate) =>
          isCreateProject(candidate.request()),
        ),
        createButton.click(),
      ]);
      const created = (await bodyAt(response, 200)) as { id: string };
      return client.get(`/api/project/${created.id}`);
    };

    // Choosing the calendar enables Create; the persisted project carries it.
    await openModal();
    await fillManagedService(uniqueProjectKey());
    expect(await createWithChosenCalendar()).toMatchObject({
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendarId,
      organisationId: null,
    });

    // The same for the customer organisation that resolves no calendar.
    await openModal();
    await fillManagedService(uniqueProjectKey());
    await choose(page, organisation, "Acme Corp");
    expect(await createWithChosenCalendar()).toMatchObject({
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: calendarId,
      organisationId: acmeId,
    });
    expect(createRequests).toBe(2);
  });
});
