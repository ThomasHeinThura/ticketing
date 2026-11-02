import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

/**
 * D7 announcements, staff side, against the mocked API: create a draft addressed to one
 * customer organisation, publish it, and request deletion through the pending-action flow.
 * The G4 scans cover the page and its dialog on desktop (light) and phone (dark) widths.
 */
const PATH = "/agent/service-management/announcements";

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

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
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        targets: v.nodes.map((node) => node.target.join(" ")),
      }));
  });
}

type Row = Record<string, unknown> & { id: string; version: number };

async function installAnnouncementsFixture(page: Page) {
  await installPerformanceApiFixture(page);
  const rows: Row[] = [];
  const calls = { created: 0, published: 0, deletions: 0 };
  await page.route("**/api/service-catalogue/status**", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        canManageServices: true,
        canManageChanges: true,
        canManageReleases: true,
      },
    }),
  );
  await page.route("**/api/announcements/audience-options**", (route) =>
    route.fulfill({
      json: {
        canAddressWorkspace: true,
        organisations: [
          { id: "org-contoso", name: "Contoso" },
          { id: "org-fabrikam", name: "Fabrikam" },
        ],
        projects: [
          {
            id: "project-portal",
            name: "Customer portal",
            organisationId: "org-contoso",
            organisationName: "Contoso",
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/announcements(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { data: rows } });
    calls.created += 1;
    const body = request.postDataJSON() as Record<string, unknown>;
    const row: Row = {
      id: "announcement-1",
      workspaceId: body.workspaceId,
      title: body.title,
      body: body.body,
      severity: body.severity,
      audience: body.audience,
      organisations: (body.organisationIds as string[]).map((id) => ({
        id,
        name: id === "org-contoso" ? "Contoso" : "Fabrikam",
      })),
      projects: [],
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      publishedAt: null,
      version: 1,
      createdAt: "2026-10-21T12:00:00.000Z",
      updatedAt: "2026-10-21T12:00:00.000Z",
      reachesAudience: true,
    };
    rows.push(row);
    return route.fulfill({ json: row });
  });
  await page.route("**/api/announcements/announcement-1/publish", (route) => {
    calls.published += 1;
    const row = rows[0];
    if (!row) return route.fulfill({ status: 404, json: {} });
    expect(route.request().postDataJSON()).toEqual({ version: row.version });
    Object.assign(row, {
      publishedAt: "2026-10-21T12:05:00.000Z",
      version: row.version + 1,
    });
    return route.fulfill({ json: row });
  });
  await page.route("**/api/announcements/announcement-1", (route) => {
    calls.deletions += 1;
    return route.fulfill({
      status: 202,
      json: {
        pendingActionId: "pending-announcement-delete",
        action: "delete",
        summary: { announcementId: "announcement-1", name: "Planned upgrade" },
        confirmation: "click",
        expiresAt: "2026-10-30T00:00:00.000Z",
        approveUrl:
          "/api/me/pending-actions/pending-announcement-delete/approve",
      },
    });
  });
  await page.route(
    "**/api/me/pending-actions/pending-announcement-delete**",
    (route) =>
      route.fulfill({
        json: {
          id: "pending-announcement-delete",
          action: "delete",
          origin: "web",
          targetType: "announcement",
          targetIds: ["announcement-1"],
          summary: {
            announcementId: "announcement-1",
            name: "Planned upgrade",
          },
          confirmation: "click",
          approvalSupported: true,
          state: "pending",
          createdAt: "2026-10-21T12:00:00.000Z",
          expiresAt: "2026-10-30T00:00:00.000Z",
          invalidationReason: null,
          decidedAt: null,
          executedAt: null,
          requestingKeyName: null,
        },
      }),
  );
  return { rows, calls };
}

test("staff create, publish and request deletion of an announcement", async ({
  page,
}) => {
  const { rows, calls } = await installAnnouncementsFixture(page);
  await page.goto(PATH);
  await expect(
    page.getByRole("heading", { name: "Announcements", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No announcements yet")).toBeVisible();
  await page.getByRole("button", { name: "New announcement" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Planned upgrade");
  await dialog.getByRole("combobox", { name: "Audience" }).click();
  await page
    .getByRole("option", { name: "Specific customer organisations" })
    .click();
  await dialog.getByRole("checkbox", { name: "Contoso" }).click();
  await dialog
    .getByLabel("Message", { exact: true })
    .fill("The portal is read-only for one hour.");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls.created).toBe(1);
  expect(rows[0]?.audience).toBe("organisations");
  expect(rows[0]?.organisations).toEqual([
    { id: "org-contoso", name: "Contoso" },
  ]);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unpublish", exact: true }),
  ).toBeVisible();
  expect(calls.published).toBe(1);
  await page
    .getByRole("button", { name: "Delete Planned upgrade", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").filter({ hasText: "Delete announcement" }),
  ).toBeVisible();
  expect(calls.deletions).toBe(1);
});

for (const [width, height, colorScheme] of [
  [1280, 720, "light"],
  [390, 844, "dark"],
] as const)
  test(`announcements page and dialog (${width}px, ${colorScheme}) have no serious or critical axe violations @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await installAnnouncementsFixture(page);
    await page.goto(PATH);
    await expect(page.getByText("No announcements yet")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "New announcement" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await seriousOrCriticalViolations(page)).toEqual([]);
  });
