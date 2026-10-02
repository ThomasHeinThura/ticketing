import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

const workspaceId = "workspace-calendar-e2e";
const calendarId = "calendar-e2e-1";
const loadingCalendarId = "calendar-e2e-loading";

type CalendarFixture = {
  id: string;
  workspaceId: string;
  name: string;
  timezone: string;
  windows: Record<
    "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
    Array<{ from: number; to: number }>
  >;
  holidays: Array<{ date: string; name?: string }>;
};

const calendar: CalendarFixture = {
  id: calendarId,
  workspaceId,
  name: "Support coverage",
  timezone: "Europe/London",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [{ from: 540, to: 1020 }],
    thu: [{ from: 540, to: 1020 }],
    fri: [{ from: 540, to: 1020 }],
    sat: [],
    sun: [],
  },
  holidays: [{ date: "2026-12-25", name: "Winter closure" }],
};

async function expectNoSeriousAxeViolations(page: Page) {
  if (
    !(await page.evaluate(() =>
      Boolean((window as Window & { axe?: unknown }).axe),
    ))
  ) {
    await page.addScriptTag({ content: axeCoreSource });
  }
  const seriousOrCriticalViolations = await page.evaluate(async () => {
    type BrowserAxe = {
      run: (context: Document) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          help: string;
          nodes: Array<{ target: string[]; failureSummary?: string }>;
        }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    const { violations } = await axe.run(document);
    return violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes }));
  });
  expect(seriousOrCriticalViolations).toEqual([]);
}

type CalendarPageFixture = {
  get savedCalendar(): CalendarFixture;
  set savedCalendar(value: CalendarFixture);
  get listIsEmpty(): boolean;
  set listIsEmpty(value: boolean);
  get listRequestFailure(): boolean;
  set listRequestFailure(value: boolean);
  get paginationEnabled(): boolean;
  set paginationEnabled(value: boolean);
  get editorRequestFailure(): boolean;
  set editorRequestFailure(value: boolean);
  get previewRequestFailure(): boolean;
  set previewRequestFailure(value: boolean);
  get holdListResponse(): boolean;
  set holdListResponse(value: boolean);
  get holdEditorResponse(): boolean;
  set holdEditorResponse(value: boolean);
  listResponseHeldPromise: Promise<void>;
  editorResponseHeldPromise: Promise<void>;
  releaseListResponse(): void;
  releaseEditorResponse(): void;
  get patchPayload(): CalendarFixture | undefined;
  get createPayload(): Omit<CalendarFixture, "id"> | undefined;
  get canManageServiceCalendars(): boolean;
  set canManageServiceCalendars(value: boolean);
};

async function setupCalendarPage(page: Page): Promise<CalendarPageFixture> {
  let savedCalendar = { ...calendar };
  let listIsEmpty = false;
  let listRequestFailure = false;
  let paginationEnabled = false;
  let editorRequestFailure = false;
  let previewRequestFailure = false;
  let holdListResponse = false;
  let holdEditorResponse = false;
  let releaseListResponse: (() => void) | undefined;
  let releaseEditorResponse: (() => void) | undefined;
  let listResponseHeld: (() => void) | undefined;
  let editorResponseHeld: (() => void) | undefined;
  const listResponseHeldPromise = new Promise<void>((resolve) => {
    listResponseHeld = resolve;
  });
  const editorResponseHeldPromise = new Promise<void>((resolve) => {
    editorResponseHeld = resolve;
  });
  let patchPayload: CalendarFixture | undefined;
  let createPayload: Omit<CalendarFixture, "id"> | undefined;
  let canManageServiceCalendars = true;

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const shifts: Array<{ value: number; startTime: number }> = [];
    Object.assign(window, { __calendarLayoutShifts: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<{
        hadRecentInput: boolean;
        value: number;
        startTime: number;
      }>) {
        if (!entry.hadRecentInput) {
          shifts.push({ value: entry.value, startTime: entry.startTime });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "session-e2e",
          userId: "user-e2e",
          token: "session-token-e2e",
          expiresAt: "2027-01-01T00:00:00.000Z",
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
          activeOrganizationId: workspaceId,
        },
        user: {
          id: "user-e2e",
          name: "Calendar Admin",
          email: "calendar-admin@example.test",
          emailVerified: true,
          image: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
        },
      }),
    }),
  );
  await page.route("**/api/workspace", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: workspaceId,
          name: "Support workspace",
          slug: "support",
          logo: null,
          description: null,
          createdAt: "2026-09-29T00:00:00.000Z",
          role: "owner",
        },
      ]),
    }),
  );
  await page.route("**/api/workspace/*/members", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "user-e2e",
          role: canManageServiceCalendars ? "admin" : "viewer",
        },
      ]),
    }),
  );
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        manageProjects: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: false,
        createTasks: false,
        deleteTasks: false,
        assignTasks: false,
        createLabels: false,
        updateLabels: false,
        deleteLabels: false,
        manageWorkspace: false,
        deleteWorkspace: false,
        inviteUsers: false,
        manageTeam: false,
        removeMembers: false,
        manageServiceCalendars: canManageServiceCalendars,
      }),
    }),
  );
  await page.route("**/api/service-calendars**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === "GET" && path === "/api/service-calendars") {
      if (holdListResponse) {
        listResponseHeld?.();
        await new Promise<void>((resolve) => {
          releaseListResponse = resolve;
        });
      }
      if (listRequestFailure) {
        await route.fulfill({
          status: 503,
          body: "Calendar service unavailable",
        });
        return;
      }
      const requestedCursor = url.searchParams.get("cursor");
      const firstPage =
        !requestedCursor || requestedCursor === "previous-page-cursor";
      const secondPage =
        requestedCursor === "next-page-cursor" ||
        requestedCursor === "previous-to-second";
      const thirdPage = requestedCursor === "third-page-cursor";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: listIsEmpty
            ? []
            : paginationEnabled && secondPage
              ? [
                  {
                    ...savedCalendar,
                    id: "calendar-e2e-2",
                    name: "Second page calendar",
                  },
                ]
              : paginationEnabled && thirdPage
                ? [
                    {
                      ...savedCalendar,
                      id: "calendar-e2e-3",
                      name: "Third page calendar",
                    },
                  ]
                : [savedCalendar],
          page: {
            previousCursor:
              listIsEmpty || !paginationEnabled || firstPage
                ? null
                : secondPage
                  ? "previous-page-cursor"
                  : "previous-to-second",
            nextCursor:
              listIsEmpty || !paginationEnabled || thirdPage
                ? null
                : firstPage
                  ? "next-page-cursor"
                  : "third-page-cursor",
            hasMore: paginationEnabled && !listIsEmpty && !thirdPage,
          },
          meta: { total: paginationEnabled ? 3 : listIsEmpty ? 0 : 1 },
        }),
      });
      return;
    }

    if (request.method() === "GET" && path.endsWith("/preview")) {
      if (previewRequestFailure) {
        await route.fulfill({ status: 503, body: "Preview unavailable" });
        return;
      }
      const year = Number(url.searchParams.get("year"));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          calendarId: path.split("/").at(-2),
          year,
          weeklyCoverMinutes: 2400,
          annualCoverMinutes: year === 2027 ? 104400 : 104160,
          hasCover: true,
        }),
      });
      return;
    }

    if (
      request.method() === "GET" &&
      (path === `/api/service-calendars/${savedCalendar.id}` ||
        path === `/api/service-calendars/${loadingCalendarId}`)
    ) {
      if (holdEditorResponse) {
        editorResponseHeld?.();
        await new Promise<void>((resolve) => {
          releaseEditorResponse = resolve;
        });
      }
      if (editorRequestFailure) {
        await route.fulfill({ status: 503, body: "Calendar unavailable" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedCalendar),
      });
      return;
    }

    if (
      request.method() === "PATCH" &&
      path === `/api/service-calendars/${savedCalendar.id}`
    ) {
      patchPayload = request.postDataJSON() as CalendarFixture;
      savedCalendar = { ...savedCalendar, ...patchPayload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedCalendar),
      });
      return;
    }

    if (request.method() === "POST" && path === "/api/service-calendars") {
      createPayload = request.postDataJSON() as Omit<CalendarFixture, "id">;
      savedCalendar = { id: "calendar-created-e2e", ...createPayload };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(savedCalendar),
      });
      return;
    }

    await route.fulfill({ status: 404, body: "Not found in browser fixture" });
  });

  return {
    get savedCalendar() {
      return savedCalendar;
    },
    set savedCalendar(value) {
      savedCalendar = value;
    },
    get listIsEmpty() {
      return listIsEmpty;
    },
    set listIsEmpty(value) {
      listIsEmpty = value;
    },
    get listRequestFailure() {
      return listRequestFailure;
    },
    set listRequestFailure(value) {
      listRequestFailure = value;
    },
    get paginationEnabled() {
      return paginationEnabled;
    },
    set paginationEnabled(value) {
      paginationEnabled = value;
    },
    get editorRequestFailure() {
      return editorRequestFailure;
    },
    set editorRequestFailure(value) {
      editorRequestFailure = value;
    },
    get previewRequestFailure() {
      return previewRequestFailure;
    },
    set previewRequestFailure(value) {
      previewRequestFailure = value;
    },
    get holdListResponse() {
      return holdListResponse;
    },
    set holdListResponse(value) {
      holdListResponse = value;
    },
    get holdEditorResponse() {
      return holdEditorResponse;
    },
    set holdEditorResponse(value) {
      holdEditorResponse = value;
    },
    listResponseHeldPromise,
    editorResponseHeldPromise,
    releaseListResponse: () => releaseListResponse?.(),
    releaseEditorResponse: () => releaseEditorResponse?.(),
    get patchPayload() {
      return patchPayload;
    },
    get createPayload() {
      return createPayload;
    },
    get canManageServiceCalendars() {
      return canManageServiceCalendars;
    },
    set canManageServiceCalendars(value) {
      canManageServiceCalendars = value;
    },
  };
}

test("calendar list server cursors support Previous, deep links, and browser Back", async ({
  page,
}) => {
  // Fixture cursors exercise UI navigation; PostgreSQL integration covers cursor issuance and seeking.
  const fixture = await setupCalendarPage(page);
  fixture.paginationEnabled = true;
  await page.goto("/agent/settings/calendars");
  await expect(
    page.getByRole("link", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/cursor=next-page-cursor/);
  await expect(page).not.toHaveURL(/history=/);
  await expect(
    page.getByRole("link", { name: "Second page calendar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(/cursor=previous-page-cursor/);
  await expect(
    page.getByRole("link", { name: "Support coverage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/cursor=previous-page-cursor/);
  await page.goto("/agent/settings/calendars?cursor=third-page-cursor");
  await expect(
    page.getByRole("link", { name: "Third page calendar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page).toHaveURL(/cursor=previous-to-second/);
  await expect(
    page.getByRole("link", { name: "Second page calendar" }),
  ).toBeVisible();
});

test("calendar list and editor preserve URL state and confirm manual changes", async ({
  page,
}, testInfo) => {
  const fixture = await setupCalendarPage(page);
  await page.goto("/agent/settings/calendars");
  await expect(
    page.getByRole("heading", { name: "Service calendars" }),
  ).toBeVisible();
  await expect(page.getByText("40 h/week")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("calendar-list-dark.png"),
  });
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("link", { name: "Support coverage" }).click();
  await expect(page).toHaveURL(/\/agent\/settings\/calendars\/calendar-e2e-1/);
  await expect(
    page.getByRole("heading", { name: "Support coverage" }),
  ).toBeVisible();
  await expect(page.getByText("40 hours of cover per week")).toBeVisible();

  await page.getByLabel("Preview year").fill("2027");
  await page.getByLabel("Preview year").press("Tab");
  await expect(page).toHaveURL(/year=2027/);
  await expect(page.getByText("2027 after holidays")).toBeVisible();

  const draggableWindow = page.getByRole("button", {
    name: /Move Monday window 1 from 09:00 to 17:00/,
  });
  const dragBox = await draggableWindow.boundingBox();
  expect(dragBox).not.toBeNull();
  if (!dragBox) throw new Error("Calendar window drag handle has no bounds");
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 32,
    dragBox.y + dragBox.height / 2,
    {
      steps: 4,
    },
  );
  await page.mouse.up();
  await expect(page.getByLabel("Monday window 1 start")).not.toHaveValue(
    "09:00",
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel("Name", { exact: true }).fill("London support");
  await page
    .getByLabel("IANA timezone", { exact: true })
    .fill("America/New_York");
  await page.getByLabel("Monday window 1 start").fill("10:00");
  await page.getByRole("button", { name: "Add holiday" }).click();
  await page.getByLabel("Date").nth(1).fill("2026-12-26");
  await page.getByRole("button", { name: "Save changes" }).click();
  const timezoneDialog = page.getByRole("alertdialog", {
    name: "Confirm calendar timezone change",
  });
  await expect(timezoneDialog).toBeVisible();
  await expect(
    timezoneDialog.getByText(/affected open-item count is not available yet/i),
  ).toBeVisible();
  expect(fixture.patchPayload).toBeUndefined();
  await expectNoSeriousAxeViolations(page);
  await timezoneDialog
    .getByRole("button", { name: "Confirm and save" })
    .click();

  await expect(page.getByText("Service calendar saved")).toBeVisible();
  expect(fixture.patchPayload?.name).toBe("London support");
  expect(fixture.patchPayload?.timezone).toBe("America/New_York");
  expect(fixture.patchPayload?.windows.mon[0]?.from).toBe(600);
  expect(fixture.patchPayload?.holidays).toHaveLength(2);
  await page.screenshot({
    path: testInfo.outputPath("calendar-editor-mobile.png"),
  });

  await expectNoSeriousAxeViolations(page);
});

test("calendar creation supports keyboard input and read-only access", async ({
  page,
}) => {
  const fixture = await setupCalendarPage(page);
  await page.goto("/agent/settings/calendars");
  await page.getByRole("link", { name: "New calendar" }).click();
  await page.getByLabel("Name", { exact: true }).fill("New regional cover");
  await page
    .getByLabel("IANA timezone", { exact: true })
    .fill("America/New_York");
  await page.getByRole("button", { name: "Add window on Monday" }).click();
  await page.getByLabel("Monday window 1 start").fill("09:00");
  await page.getByLabel("Monday window 1 end", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: "Create calendar" }).click();
  await expect(page).toHaveURL(/calendar-created-e2e/);
  await expect(
    page.getByRole("heading", { name: "New regional cover" }),
  ).toBeVisible();
  expect(fixture.createPayload?.workspaceId).toBe(workspaceId);
  expect(fixture.createPayload?.windows.mon).toEqual([{ from: 540, to: 1020 }]);

  // G10: edit weekly cover with keyboard input and leave the control by Tab.
  const keyboardStartTime = page.getByLabel("Monday window 1 start");
  await keyboardStartTime.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("10:00");
  await page.keyboard.press("Tab");
  await expect(keyboardStartTime).toHaveValue("10:00");

  fixture.canManageServiceCalendars = false;
  await page.goto("/agent/settings/calendars");
  await expect(page.getByText("Read-only access")).toBeVisible();
  await expect(page.getByRole("button", { name: "New calendar" })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "New regional cover" }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
  await page.goto("/agent/settings/calendars/new");
  await expect(
    page.getByRole("button", { name: "Create calendar" }),
  ).toBeDisabled();
});

test("calendar list and editor expose loading, empty, error, and partial states", async ({
  page,
}) => {
  const fixture = await setupCalendarPage(page);
  // G6: loading, empty, error, and partial states are all reachable in-browser.
  fixture.canManageServiceCalendars = true;
  fixture.savedCalendar = { ...calendar };
  fixture.holdListResponse = true;
  const loadingNavigation = page.goto("/agent/settings/calendars");
  await fixture.listResponseHeldPromise;
  await expect(
    page.getByRole("status", { name: "Loading service calendars" }),
  ).toBeVisible();
  await page.evaluate(() => performance.mark("calendar-skeleton-visible"));
  fixture.releaseListResponse();
  await loadingNavigation;
  fixture.holdListResponse = false;
  await expect(
    page.getByRole("link", { name: "Support coverage" }),
  ).toBeVisible();
  await page.evaluate(() => performance.mark("calendar-content-mounted"));
  const layoutShiftTotal = await page.evaluate(() => {
    const start = performance.getEntriesByName("calendar-skeleton-visible")[0]
      ?.startTime;
    const end = performance.getEntriesByName("calendar-content-mounted")[0]
      ?.startTime;
    const shifts = (
      window as typeof window & {
        __calendarLayoutShifts: Array<{ value: number; startTime: number }>;
      }
    ).__calendarLayoutShifts;
    if (start === undefined || end === undefined)
      return Number.POSITIVE_INFINITY;
    return shifts
      .filter((entry) => entry.startTime >= start && entry.startTime <= end)
      .reduce((total, entry) => total + entry.value, 0);
  });
  // G13: the list's skeleton-to-content layout shift must stay below 0.1.
  expect(layoutShiftTotal).toBeLessThan(0.1);

  fixture.holdEditorResponse = true;
  const editorLoadingNavigation = page.goto(
    `/agent/settings/calendars/${loadingCalendarId}`,
  );
  await fixture.editorResponseHeldPromise;
  await expect(
    page.getByRole("status", { name: "Loading service calendar" }),
  ).toBeAttached();
  fixture.releaseEditorResponse();
  await editorLoadingNavigation;
  fixture.holdEditorResponse = false;
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Support coverage",
  );

  await page.goto("/agent/settings/calendars");
  fixture.listIsEmpty = true;
  await page.reload();
  await expect(page.getByText("No service calendars yet")).toBeVisible();
  await page.goto("/agent/settings/calendars?cursor=stale-boundary");
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page).not.toHaveURL(/cursor=/);

  fixture.listIsEmpty = false;
  fixture.listRequestFailure = true;
  await page.reload();
  await expect(page.getByText("Calendars could not be loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  fixture.listRequestFailure = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("40 h/week")).toBeVisible();

  fixture.editorRequestFailure = true;
  await page.goto(`/agent/settings/calendars/${calendarId}`);
  await expect(page.getByText("Calendar could not be loaded")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to calendars" }),
  ).toBeVisible();

  fixture.editorRequestFailure = false;
  fixture.previewRequestFailure = true;
  await page.goto(`/agent/settings/calendars/${calendarId}`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Support coverage",
  );
  await expect(
    page.getByText("Coverage preview is unavailable."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry preview" }),
  ).toBeVisible();
});
