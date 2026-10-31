import { expect, type Page, type Route, test } from "@playwright/test";
import { seriousOrCriticalViolations } from "./helpers/axe";
import {
  installPerformanceApiFixture,
  PROJECT_ID,
  TYPE_ID,
} from "./helpers/g11-performance-fixture";

// S2 (G4): the open submission is a modal Kaneo side sheet over the triage queue. Its dialog
// name, header, convert footer, form labels and status live region must pass axe with the
// sheet open, on desktop and at phone width.
const TRIAGE_SHEET = "/agent/triage?state=new&ref=SUB-7";

async function mountTriageApp(page: Page) {
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
  // Registered after the shared fixture, so these take precedence.
  await page.route("**/api/submissions**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api/submissions/SUB-7/attachments"))
      return json(route, []);
    if (path.endsWith("/api/submissions/SUB-7/duplicates"))
      return json(route, { suggestions: [] });
    if (path.endsWith("/api/submissions/SUB-7"))
      return json(route, {
        submission: {
          state: "new",
          formData: { title: "Request access to the support workspace" },
          requesterId: "a11y-requester",
          organisationId: "a11y-organisation",
          workItemId: null,
        },
        requestType: { name: "Access request" },
        version: {
          defaultProjectId: PROJECT_ID,
          workItemTypeId: TYPE_ID,
          formSchema: {
            fields: [
              { key: "title", label: "Summary", type: "text", required: true },
            ],
          },
        },
        messages: [],
      });
    if (path.endsWith("/api/submissions"))
      return json(route, {
        submissions: [
          {
            ref: "SUB-7",
            summary: "Request access to the support workspace",
            submission: { state: "new", createdAt: "2026-09-15T00:00:00.000Z" },
            requestType: { id: "a11y-request-type", name: "Access request" },
            requester: { displayName: "Ada Example" },
            organisation: { name: "Northstar Support" },
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    return route.fallback();
  });
  await page.route("**/api/request-types**", (route) =>
    json(route, { requestTypes: [] }),
  );
  await page.route("**/api/intake/queues**", (route) => json(route, []));
  await page.route("**/api/kb/deflection**", (route) =>
    json(route, { articles: [], portalBaseUrl: "https://portal.example.test" }),
  );
}

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 720 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`triage submission sheet (${name}) has no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mountTriageApp(page);
    await page.goto(TRIAGE_SHEET);
    const sheet = page.getByRole("dialog", { name: "Submission SUB-7" });
    await expect(sheet).toBeVisible();
    // Wait for the lazy body, not the fallback, so axe scans the real sheet.
    await expect(sheet.getByText("Submitted answers")).toBeVisible();
    await expect(
      sheet.getByRole("heading", { level: 2, name: "Access request" }),
    ).toBeVisible();
    await expect(sheet.getByRole("status")).toContainText("Status: New");
    await expect(sheet.getByLabel("Clarification message")).toBeVisible();
    // The convert footer resolves its project and type defaults before the scan.
    const convert = sheet.getByRole("region", { name: "Convert to Work item" });
    await expect(
      convert.getByRole("button", { name: "Destination project" }),
    ).toContainText("Performance fixture");
    await expect(convert.getByRole("button", { name: "Accept" })).toBeVisible();
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
}
