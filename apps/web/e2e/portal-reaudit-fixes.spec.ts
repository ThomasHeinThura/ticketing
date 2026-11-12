import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";

// UAT re-audit (3 Nov 2026) fixes, checked in the built portal (`dist/portal`, from
// `pnpm build`) on a portal origin with fixture API reads: who a team-raised request is for,
// notifications read on open, sidebar labels, the submission page, help search, focus after a
// reply or a removed file, an unknown project scope, page titles and one <main> landmark.
const PORTAL_ORIGIN = "http://portal.localhost:4181";
const PORTAL_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/portal",
);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const session = {
  session: {
    id: "reaudit-session",
    userId: "reaudit-customer",
    activeOrganizationId: null,
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "reaudit-token",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  user: {
    id: "reaudit-customer",
    name: "Ada Example",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    image: null,
  },
};

const baseCase = {
  requestTypeName: "Incident",
  raisedBySupport: false,
  createdAt: "2026-11-01T09:00:00.000Z",
  updatedAt: "2026-11-03T21:59:00.000Z",
  project: { key: "HELP", name: "Help desk" },
  customerVisibility: "organisation",
  sla: null,
};

const cases = [
  {
    ...baseCase,
    ref: "HELP-7",
    source: "direct",
    title: "VPN drops every 10 minutes",
    priority: "high",
    customerStatus: "in_progress",
    createdBy: { name: null, isYou: true },
    isRequester: true,
    raisedBySupport: true,
  },
  {
    ...baseCase,
    ref: "HELP-8",
    source: "direct",
    title: "Printer queue stuck",
    priority: "medium",
    customerStatus: "need_more_info",
    createdBy: { name: "Dana Customer", isYou: false },
    isRequester: false,
    raisedBySupport: true,
  },
  {
    ...baseCase,
    ref: "SUB-5",
    source: "submission",
    title: "Short summary of the VPN issue",
    requestTypeName: "VPN access",
    priority: "urgent",
    customerStatus: "received",
    createdBy: { name: null, isYou: true },
    isRequester: true,
  },
];

const project = {
  key: "HELP",
  name: "Help desk",
  kind: "managed_service",
  status: "active",
  health: "green",
  counts: { actionRequired: 1, outstanding: 2 },
};

const projectDetail = {
  ...project,
  description: "Run the help desk.",
  createdAt: "2026-01-05T09:00:00.000Z",
  supportLevel: "L2",
  serviceCalendarName: "Business hours",
  summary: {
    objective: "Answer every request within a day.",
    inScope: null,
    outOfScope: null,
    successCriteria: null,
  },
  goLive: null,
  milestones: [],
  prerequisites: [],
  documents: [],
  contacts: [],
  contract: {
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    period: {
      state: "active",
      totalDays: 365,
      elapsedDays: 307,
      daysRemaining: 58,
      elapsedPct: 84,
    },
    hours: {
      contractedMinutes: 6000,
      usedMinutes: 3000,
      remainingMinutes: 3000,
      usedPct: 50,
    },
  },
};

const requestDetail = {
  ...cases[0],
  description: "The VPN client disconnects every ten minutes.",
  resolvedAt: null,
  customFields: [],
  canReply: true,
  canViewAttachments: true,
  canUpload: true,
  messages: [
    {
      id: "help-7-c1",
      actorType: "triager",
      authorName: "Sam Support",
      mine: false,
      body: "Can you send the client log?",
      createdAt: "2026-11-03T21:00:00.000Z",
    },
  ],
};

const submissionDetail = {
  ref: "SUB-5",
  submission: {
    state: "accepted",
    formData: { details: "It stopped at 9am", summary: "VPN down" },
    customerVisibility: "private",
    createdAt: "2026-10-31T19:55:13.000Z",
  },
  customerStatus: "in_progress",
  isRequester: true,
  canViewAttachments: true,
  canUpload: true,
  canWithdraw: false,
  canEscalate: false,
  canReopen: false,
  canRate: false,
  satisfaction: null,
  requestType: {
    name: "VPN access",
    description: null,
    icon: null,
    group: "Network",
  },
  version: {
    formSchema: {
      fields: [
        { key: "summary", type: "text", label: "Short summary" },
        { key: "details", type: "textarea", label: "What happened?" },
      ],
    },
  },
  workItem: {
    title: "Short summary of the VPN issue",
    description: "",
    priority: "urgent",
    resolvedAt: null,
    sla: null,
  },
  customFields: [],
  messages: [
    {
      id: "sub-5-m1",
      actorType: "triager",
      authorName: "Sam Support",
      mine: false,
      body: "We are looking at it.",
      reasonCode: null,
      reasonParams: null,
      createdAt: "2026-10-31T20:10:00.000Z",
    },
  ],
};

type Fixture = {
  unreadIds: Set<string>;
  replies: number;
  reads: string[];
  sub6Replied: boolean;
};

/** A request still with the team's triage: it asked for more information (IQ-13). */
function clarifyingSubmission(replied: boolean) {
  return {
    ...submissionDetail,
    ref: "SUB-6",
    submission: {
      ...submissionDetail.submission,
      state: replied ? "new" : "clarifying",
    },
    customerStatus: replied ? "received" : "need_more_info",
    workItem: null,
    messages: [
      {
        id: "sub-6-m1",
        actorType: "triager",
        authorName: "Sam Support",
        mine: false,
        body: "Which office are you in?",
        reasonCode: null,
        reasonParams: null,
        createdAt: "2026-11-01T08:00:00.000Z",
      },
      ...(replied
        ? [
            {
              id: "sub-6-m2",
              actorType: "customer",
              authorName: null,
              mine: true,
              body: "Singapore",
              reasonCode: null,
              reasonParams: null,
              createdAt: "2026-11-01T09:00:00.000Z",
            },
          ]
        : []),
    ],
  };
}

function notificationPage(fixture: Fixture) {
  const all = [
    {
      id: "n1",
      kind: "work_item.commented",
      createdAt: "2026-11-03T21:59:05.000Z",
      targetKind: "request",
      requestRef: "HELP-7",
      commentId: "help-7-c1",
    },
    {
      id: "n2",
      kind: "submission.replied",
      createdAt: "2026-11-02T10:00:00.000Z",
      targetKind: "submission",
      requestRef: "SUB-5",
      commentId: null,
    },
  ];
  return {
    data: all.map((row) => ({
      ...row,
      isRead: !fixture.unreadIds.has(row.id),
    })),
    unreadCount: fixture.unreadIds.size,
    hasMore: false,
    nextCursor: null,
  };
}

function apiBody(
  method: string,
  pathname: string,
  url: URL,
  fixture: Fixture,
): { status?: number; body: unknown } | undefined {
  const read = /^\/api\/portal\/notification\/([^/]+)\/read$/u.exec(pathname);
  if (method === "PATCH" && read?.[1]) {
    fixture.unreadIds.delete(read[1]);
    fixture.reads.push(read[1]);
    return { body: { success: true } };
  }
  if (
    method === "POST" &&
    pathname === "/api/portal/requests/HELP-7/comments"
  ) {
    fixture.replies += 1;
    return {
      body: {
        ref: "HELP-7",
        message: {
          id: `help-7-r${fixture.replies}`,
          actorType: "customer",
          authorName: null,
          mine: true,
          body: "Log attached",
          createdAt: "2026-11-03T22:10:00.000Z",
        },
      },
    };
  }
  if (
    method === "POST" &&
    pathname === "/api/portal/submissions/SUB-6/messages"
  ) {
    fixture.sub6Replied = true;
    return { body: { message: { id: "sub-6-m2" } } };
  }
  switch (pathname) {
    case "/api/portal/submissions/SUB-6":
      return { body: clarifyingSubmission(fixture.sub6Replied) };
    case "/api/portal/submissions/SUB-6/attachments":
      return { body: [] };
    case "/api/auth/get-session":
      return { body: session };
    case "/api/config":
      return { body: { disableRegistration: true, disableLoginForm: false } };
    case "/api/public/terminology":
    case "/api/portal/terminology":
      return { body: {} };
    case "/api/me/settings":
      return { body: { settings: {} } };
    case "/api/portal/feature-state":
      return { body: { state: "on" } };
    case "/api/portal/me":
      return {
        body: {
          name: "Ada Example",
          email: "ada@example.test",
          image: null,
          jobTitle: null,
          organisation: { name: "Contoso" },
        },
      };
    case "/api/portal/home":
      return {
        body: {
          actionRequired: { total: 1, cases: 1, approvals: 0 },
          outstanding: 2,
          closedLast30Days: 1,
          averageFirstResponse: { seconds: 5400, sampleSize: 4 },
        },
      };
    case "/api/portal/projects":
      return { body: { data: [project] } };
    case "/api/portal/projects/HELP":
      return { body: projectDetail };
    case "/api/portal/requests": {
      const q = url.searchParams.get("q")?.toLowerCase();
      const rows = q
        ? cases.filter((row) =>
            `${row.ref} ${row.title}`.toLowerCase().includes(q),
          )
        : cases;
      return {
        body: {
          cases: rows,
          page: { hasMore: false, nextCursor: null },
          meta: { total: rows.length },
        },
      };
    }
    case "/api/portal/requests/HELP-7":
      return { body: requestDetail };
    case "/api/portal/requests/HELP-7/attachments":
      return { body: [] };
    case "/api/portal/submissions/SUB-5":
      return { body: submissionDetail };
    case "/api/portal/submissions/SUB-5/attachments":
      return {
        body: [
          {
            id: "f1",
            filename: "audit-3nov-skeptic.txt",
            mimeType: "text/plain",
            size: 46,
            submissionFieldKey: null,
            state: "ready",
            downloadable: true,
          },
        ],
      };
    case "/api/portal/submissions/SUB-999":
      return { status: 404, body: { error: "Submission not found" } };
    case "/api/portal/kb":
      return url.searchParams.get("q")
        ? {
            body: {
              articles: [
                {
                  id: "kb-vpn",
                  title: "How to reset your VPN client",
                  snippet: "Restart the client, then sign in again.",
                  categoryId: null,
                  publishedAt: "2026-10-01T00:00:00.000Z",
                },
              ],
              total: 1,
            },
          }
        : { body: { articles: [], total: 1 } };
    case "/api/portal/kb/categories":
      return { body: [] };
    case "/api/portal/catalogue":
      return {
        body: {
          defaultCustomerVisibility: "organisation",
          requestTypes: [
            {
              key: "vpn",
              name: "VPN access",
              description: "Get VPN access for a new laptop.",
              icon: null,
              group: "Network",
              position: 0,
              forcePrivate: false,
              formSchema: {
                fields: [
                  { key: "summary", label: "Short summary", type: "text" },
                ],
              },
              version: 1,
            },
          ],
        },
      };
    case "/api/portal/catalogue/vpn":
      return {
        body: {
          key: "vpn",
          name: "VPN access",
          description: "Get VPN access for a new laptop.",
          formSchema: {
            fields: [{ key: "summary", label: "Short summary", type: "text" }],
          },
          version: 1,
        },
      };
    case "/api/portal/approvals":
      return { body: { approvals: [] } };
    case "/api/portal/releases":
      return { body: { data: [] } };
    case "/api/portal/announcements":
      return { body: { data: [], nextCursor: null } };
    case "/api/portal/notification/inbox":
      return { body: notificationPage(fixture) };
    default:
      return undefined;
  }
}

async function mountPortal(page: Page) {
  if (!existsSync(path.join(PORTAL_DIST, "index.html")))
    throw new Error(
      `The built portal is missing at ${PORTAL_DIST}; run \`pnpm build\` first.`,
    );
  const indexHtml = readFileSync(path.join(PORTAL_DIST, "index.html"));
  const fixture: Fixture = {
    unreadIds: new Set(["n1", "n2"]),
    replies: 0,
    reads: [],
    sub6Replied: false,
  };
  await page.route(`${PORTAL_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/")) {
      const answer = apiBody(
        route.request().method(),
        url.pathname,
        url,
        fixture,
      );
      if (answer === undefined) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({
        status: answer.status ?? 200,
        contentType: "application/json",
        body: JSON.stringify(answer.body),
      });
    }
    const file = path.join(PORTAL_DIST, path.normalize(url.pathname));
    if (
      file.startsWith(PORTAL_DIST) &&
      url.pathname !== "/" &&
      existsSync(file) &&
      statSync(file).isFile()
    )
      return route.fulfill({
        status: 200,
        contentType:
          CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
    return route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[".html"],
      body: indexHtml,
    });
  });
  return fixture;
}

/** The screenshots a reviewer reads (the PR's browser evidence), in the test's output folder. */
async function evidence(page: Page, name: string) {
  await page.screenshot({
    path: test.info().outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function shellReady(page: Page) {
  // The lazy top bar has painted (at phone width the label is visually hidden and the
  // navigation sits in a closed sheet).
  await expect(page.getByRole("link", { name: "Get help" })).toBeVisible();
}

const THEMES = ["light", "dark"] as const;
const VIEWPORTS = [
  ["desktop", { width: 1280, height: 860 }],
  ["mobile", { width: 390, height: 844 }],
] as const;

for (const theme of THEMES)
  for (const [viewportName, viewport] of VIEWPORTS) {
    const tag = `${viewportName}-${theme}`;
    test.describe(`portal re-audit fixes (${tag})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme });
      });

      test(`requests list: raised-for wording, case link focus ring, one main, title (${tag}) @a11y`, async ({
        page,
      }) => {
        await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/requests`);
        await shellReady(page);
        const mine = page.getByRole("row").filter({ hasText: "HELP-7" });
        // D-K: a case raised by staff names the customer as Requester and shows the neutral
        // "Raised by: Support team" line, never a staff name.
        await expect(mine.getByText("Raised by: Support team")).toBeVisible();
        const colleague = page.getByRole("row").filter({ hasText: "HELP-8" });
        await expect(
          colleague.getByText("Raised by: Support team"),
        ).toBeVisible();
        await expect(
          colleague.getByText("Dana Customer").first(),
        ).toBeVisible();
        const selfRaised = page.getByRole("row").filter({ hasText: "SUB-5" });
        await expect(selfRaised.getByText("Raised by")).toHaveCount(0);
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page).toHaveTitle("Support Requests · Customer portal");
        const link = page.getByRole("link", { name: "HELP-7", exact: true });
        await link.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        const ring = await link.evaluate(
          (element) => getComputedStyle(element).boxShadow,
        );
        expect(ring).not.toBe("none");
        await evidence(page, `requests-${tag}`);
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
      });

      test(`notifications: opening one reads it, dates and layout, sidebar labels (${tag})`, async ({
        page,
      }) => {
        const fixture = await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/notifications`);
        await shellReady(page);
        await expect(page).toHaveTitle("Notifications · Customer portal");
        await expect(page.getByText("2 unread notifications")).toBeVisible();
        // Each entry reads like the heading of the page it opens.
        if (viewportName === "desktop") {
          const nav = page.getByRole("navigation").first();
          await expect(
            page.getByRole("link", { name: "Notifications", exact: true }),
          ).toHaveAttribute("aria-current", "page");
          await expect(
            page.getByRole("link", { name: "Projects", exact: true }),
          ).toBeVisible();
          await expect(nav.getByText("Updates", { exact: true })).toHaveCount(
            0,
          );
          await expect(
            nav.getByText("Project details", { exact: true }),
          ).toHaveCount(0);
        }
        await expect(page.getByText(/Nov 3, 2026, 9:59\sPM/u)).toBeVisible();
        await expect(page.getByText("11/3/2026")).toHaveCount(0);
        await evidence(page, `notifications-${tag}`);
        await page
          .getByRole("link", { name: "New comment on your Request" })
          .click();
        await expect(
          page.getByRole("heading", { name: "VPN drops every 10 minutes" }),
        ).toBeVisible();
        expect(fixture.reads).toEqual(["n1"]);
        // The bell's badge follows without a reload.
        await expect(
          page.getByRole("button", { name: "Open notifications" }),
        ).toHaveText("1");
        await page.goto(`${PORTAL_ORIGIN}/notifications`);
        await expect(page.getByText("1 unread notification")).toBeVisible();
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
      });

      test(`request page: reply keeps focus and announces; removing a staged file moves focus (${tag})`, async ({
        page,
      }) => {
        await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/requests/HELP-7`);
        await shellReady(page);
        await expect(page).toHaveTitle(
          "VPN drops every 10 minutes · HELP-7 · Customer portal",
        );
        await expect(page.getByText("Incident", { exact: true })).toBeVisible();
        await expect(
          page.getByText("Support team", { exact: true }),
        ).toBeVisible();
        await expect(page.locator("main")).toHaveCount(1);
        await page.locator("input[type=file]").setInputFiles([
          { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
          { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("bb") },
        ]);
        await page.getByRole("button", { name: "Remove a.txt" }).focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("button", { name: "Remove b.txt" }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(
          page.locator("button[data-slot=button]", { hasText: "Attach files" }),
        ).toBeFocused();
        const reply = page.getByRole("textbox", { name: "Reply" });
        await reply.fill("Log attached");
        await page.getByRole("button", { name: "Send reply" }).focus();
        await page.keyboard.press("Enter");
        await expect(reply).toBeFocused();
        await expect(reply).toHaveValue("");
        await expect(
          page.getByRole("status").filter({ hasText: "Reply sent" }),
        ).toBeVisible();
        await evidence(page, `request-detail-${tag}`);
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
      });

      test(`submission page reads like the request page; a missing one says not found (${tag})`, async ({
        page,
      }) => {
        await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/submissions/SUB-5`);
        await shellReady(page);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Short summary of the VPN issue",
          }),
        ).toBeVisible();
        await expect(page.getByText("SUB-5", { exact: true })).toBeVisible();
        await expect(
          page.getByRole("link", { name: "Back to Requests" }),
        ).toBeVisible();
        await expect(page.getByText("Severity", { exact: true })).toBeVisible();
        await expect(page.getByText("Urgent", { exact: true })).toBeVisible();
        await expect(page.getByText("46 B")).toBeVisible();
        await expect(page.getByText(/1 KB|· ready/u)).toHaveCount(0);
        await expect(page.getByText(/Oct 31, 2026, 8:10\sPM/u)).toBeVisible();
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page).toHaveTitle(
          "Short summary of the VPN issue · SUB-5 · Customer portal",
        );
        await evidence(page, `submission-detail-${tag}`);
        expect(await seriousOrCriticalViolations(page)).toEqual([]);

        // Still with triage: no team severity yet (never a false "Not set"); replying returns
        // the request to the team, closes the reply box and puts focus on the reply sent.
        await page.goto(`${PORTAL_ORIGIN}/submissions/SUB-6`);
        await expect(
          page.getByRole("heading", { level: 1, name: "VPN access" }),
        ).toBeVisible();
        await expect(page.getByText("Severity", { exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByText("Not set", { exact: true })).toHaveCount(0);
        const answers = page.locator("dt", {
          hasText: /Short summary|What happened\?/u,
        });
        await expect(answers.first()).toHaveText("Short summary");
        const reply = page.getByRole("textbox", { name: "Reply" });
        await reply.fill("Singapore");
        await page.getByRole("button", { name: "Send reply" }).focus();
        await page.keyboard.press("Enter");
        await expect(page.locator("#comment-sub-6-m2")).toBeFocused();
        await expect(page.getByRole("textbox", { name: "Reply" })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("status").filter({ hasText: "Reply sent" }),
        ).toHaveCount(1);
        await evidence(page, `submission-clarifying-replied-${tag}`);

        await page.goto(`${PORTAL_ORIGIN}/submissions/SUB-999`);
        await expect(
          page.getByRole("heading", { name: "We could not find this Request" }),
        ).toBeVisible({ timeout: 2500 });
        await expect(
          page.getByRole("link", { name: "Back to Requests" }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(
          0,
        );
        await evidence(page, `submission-not-found-${tag}`);
      });

      test(`top-bar search shows articles, request types and the customer's requests (${tag})`, async ({
        page,
      }) => {
        await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/`);
        await shellReady(page);
        await expect(page).toHaveTitle("Dashboard · Customer portal");
        if (viewportName === "desktop") {
          const box = page.getByRole("searchbox", { name: "Search" });
          await box.fill("VPN");
          await box.press("Enter");
        } else {
          await page.getByRole("button", { name: "Search" }).click();
          await page
            .getByRole("dialog", { name: "Search" })
            .getByRole("combobox")
            .fill("VPN");
        }
        const dialog = page.getByRole("dialog", { name: "Search" });
        await expect(
          dialog.getByRole("option", { name: /How to reset your VPN client/u }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("option", { name: /^VPN access/u }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("option", { name: /VPN drops every 10 minutes/u }),
        ).toBeVisible();
        await evidence(page, `search-${tag}`);
        expect(await seriousOrCriticalViolations(page)).toEqual([]);
        await dialog
          .getByRole("option", { name: /How to reset your VPN client/u })
          .click();
        await expect(page).toHaveURL(`${PORTAL_ORIGIN}/kb/kb-vpn`);
      });

      test(`unknown ?project= is dropped; project page and catalogue order (${tag})`, async ({
        page,
      }) => {
        await mountPortal(page);
        await page.goto(`${PORTAL_ORIGIN}/?project=ZZZQ`);
        await shellReady(page);
        await expect(page).toHaveURL(`${PORTAL_ORIGIN}/`);
        await page.goto(`${PORTAL_ORIGIN}/projects/HELP`);
        await shellReady(page);
        await expect(
          page.getByRole("heading", { level: 1, name: "Help desk" }),
        ).toBeVisible();
        await expect(page).toHaveTitle("Help desk · HELP · Customer portal");
        // The project's facts come before its cases.
        const order = await page.evaluate(() => {
          const headings = [...document.querySelectorAll("h2, h3")].map(
            (element) => element.textContent?.trim() ?? "",
          );
          return headings;
        });
        const info = order.findIndex((text) =>
          /Project information/u.test(text),
        );
        const casesAt = order.findIndex((text) =>
          /Requests|cases/iu.test(text),
        );
        expect(info).toBeGreaterThanOrEqual(0);
        expect(casesAt === -1 || info < casesAt).toBe(true);
        await evidence(page, `project-detail-${tag}`);
        await page.goto(`${PORTAL_ORIGIN}/catalogue?key=vpn`);
        await shellReady(page);
        await expect(
          page.getByRole("heading", { name: "VPN access" }).first(),
        ).toBeVisible();
        await expect(page.locator("#catalogue-search")).toHaveCount(0);
        await evidence(page, `catalogue-form-${tag}`);
      });
    });
  }
