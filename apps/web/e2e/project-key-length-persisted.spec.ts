import { expect, type Page, test } from "@playwright/test";
import {
  navigateToSetup,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import {
  createFirstWorkspace,
  enrollFirstAdmin,
} from "./helpers/enroll-first-admin";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
] as const;
const themes = ["light", "dark"] as const;

type Project = { id: string; slug: string; name: string };
type WorkItem = { id: string; key: string; title: string };

async function requestJson<T>(
  page: Page,
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const result = await page.evaluate(
    async ({ path: url, data: body }) => {
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        const issuer = await fetch("/api/me/csrf-token", {
          credentials: "same-origin",
        });
        if (!issuer.ok) return { status: issuer.status, body: null };
        const { token } = (await issuer.json()) as { token: string };
        headers["content-type"] = "application/json";
        headers["x-taskdesk-csrf"] = token;
      }
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.ok ? await response.json() : null,
      };
    },
    { path, data },
  );
  expect(result.status, "Synthetic fixture API request failed").toBe(200);
  return result.body as T;
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((value) => {
    const stored = JSON.parse(
      localStorage.getItem("user-preferences") ?? "{}",
    ) as { state?: Record<string, unknown>; version?: number };
    localStorage.setItem(
      "user-preferences",
      JSON.stringify({
        ...stored,
        state: { ...(stored.state ?? {}), theme: value },
        version: stored.version ?? 0,
      }),
    );
  }, theme);
}

test("project keys persist at 15 letters and a confirmed rename retains old work-item links", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const containers = new Set<string>();
  try {
    await withMfaCsrfApp(
      async ({ origin, email, password, setupUrl }) => {
        const context = await browser.newContext({
          viewport: viewports[0],
          locale: "en-GB",
          timezoneId: "UTC",
          reducedMotion: "reduce",
        });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(10_000);
          const at = (path: string) => new URL(path, origin).toString();
          await navigateToSetup(page, setupUrl);
          await page.getByLabel("Full name").fill("Disposable Key Owner");
          await page.getByLabel("Email").fill(email);
          await page
            .locator('input[autocomplete="new-password"]')
            .fill(password);
          await page.getByRole("button", { name: "Create account" }).click();
          await enrollFirstAdmin(page, origin, password);
          const workspaceId = await createFirstWorkspace(
            page,
            "Disposable Key Workspace",
          );
          const fixtureKey = uniqueProjectKey(8);
          await requestJson<Project>(page, "/api/project", {
            name: "Fixture project",
            icon: "Folder",
            slug: fixtureKey,
            workspaceId,
          });
          const initialKey = uniqueProjectKey(15);
          let renamedKey = uniqueProjectKey(8);
          while (renamedKey === fixtureKey) renamedKey = uniqueProjectKey(8);
          const projectName = "Edited descriptive key project";
          const openCreate = async () => {
            await page.goto(at("/agent"));
            await expect(
              page.getByTestId("g13-projects-content"),
            ).toBeVisible();
            await page
              .locator("header")
              .getByRole("button", { name: /^Create project$/i })
              .click();
            const dialog = page.getByRole("dialog");
            await expect(dialog).toBeVisible();
            return dialog;
          };

          for (const theme of themes) {
            await setTheme(page, theme);
            for (const viewport of viewports) {
              await page.setViewportSize({
                width: viewport.width,
                height: viewport.height,
              });
              const dialog = await openCreate();
              await expect(page.locator("html")).toHaveClass(new RegExp(theme));
              const name = dialog.getByPlaceholder(/name$/i);
              const key = dialog.getByRole("textbox", { name: /^Key:?$/i });
              await name.fill("Customer Support Delivery");
              await expect(key).toHaveValue("CUSTOMERSUPPORT");
              await expect(key).toHaveAttribute("maxlength", "15");
              await key.focus();
              await expect(key).toBeFocused();
              await key.fill("WWWWWWWWWWWWWWW");
              await page.keyboard.press("Tab");
              await page.keyboard.press("Shift+Tab");
              await expect(key).toBeFocused();
              await name.fill(projectName);
              await expect(key).toHaveValue("WWWWWWWWWWWWWWW");
              await key.focus();
              await key.press("End");
              const dimensions = await key.evaluate(
                (element: HTMLInputElement) => ({
                  scroll: element.scrollWidth,
                  width: element.clientWidth,
                  left: element.scrollLeft,
                }),
              );
              expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
              expect(dimensions.left).toBe(0);
              expect(
                await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth <= window.innerWidth,
                ),
              ).toBe(true);
              await expect(
                dialog.getByRole("button", { name: /^Create project$/i }),
              ).toBeInViewport();
              await dialog.screenshot({
                path: testInfo.outputPath(
                  `project-key-${viewport.name}-${theme}.png`,
                ),
              });
              await dialog.getByRole("button", { name: "Cancel" }).click();
              await expect(dialog).toHaveCount(0);
            }
          }

          await page.setViewportSize({ width: 1280, height: 800 });
          const dialog = await openCreate();
          await dialog
            .getByPlaceholder(/name$/i)
            .fill("Customer Support Delivery");
          const key = dialog.getByRole("textbox", { name: /^Key:?$/i });
          await expect(key).toHaveValue("CUSTOMERSUPPORT");
          await key.fill(initialKey);
          await dialog.getByPlaceholder(/name$/i).fill(projectName);
          await expect(key).toHaveValue(initialKey);
          const create = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/api/project" &&
              response.request().method() === "POST",
          );
          await dialog
            .getByRole("button", { name: /^Create project$/i })
            .click();
          const created = await create;
          expect(created.status()).toBe(200);
          const project = (await created.json()) as Project;
          expect(project.slug).toBe(initialKey);
          await expect(page).toHaveURL(new RegExp(`/${project.id}(?:/|\\?|$)`));
          expect(
            await requestJson<Project>(
              page,
              `/api/project/${encodeURIComponent(project.id)}`,
            ),
          ).toMatchObject({
            id: project.id,
            slug: initialKey,
            name: projectName,
          });
          await page.goto(
            at(`/agent/projects/${encodeURIComponent(initialKey)}`),
          );
          await expect(page.getByTestId("project-overview-page")).toBeVisible();
          await expect(page).toHaveURL(
            new RegExp(`/agent/projects/${initialKey}(?:/|\\?|$)`),
          );
          await page.reload();
          await expect(page.getByTestId("project-overview-page")).toBeVisible();
          expect(
            (
              await requestJson<Project>(
                page,
                `/api/project/${encodeURIComponent(project.id)}`,
              )
            ).slug,
          ).toBe(initialKey);

          const types = await requestJson<Array<{ id: string; key: string }>>(
            page,
            `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
          );
          const taskType = types.find((entry) => entry.key === "task");
          if (!taskType)
            throw new Error("Disposable workspace task type missing");
          const createItemPath = `/api/projects/${encodeURIComponent(project.id)}/work-items`;
          const originalItem = await requestJson<WorkItem>(
            page,
            createItemPath,
            { typeId: taskType.id, title: "Original prefix item" },
          );
          expect(originalItem.key).toBe(`${initialKey}-1`);
          await page.goto(
            at(
              `/agent/projects/${encodeURIComponent(initialKey)}/work?layout=board`,
            ),
          );
          const itemLink = page.getByRole("link", {
            name: /Original prefix item/,
          });
          const itemPath = `/agent/work-items/${originalItem.key}`;
          await expect(itemLink).toBeVisible();
          await expect(itemLink).toHaveAttribute("href", itemPath);
          await page.goto(at(itemPath));
          await expect(page.getByTestId("work-item-detail")).toBeVisible();
          await expect(page.getByTestId("work-item-detail")).toContainText(
            "Original prefix item",
          );

          await page.goto(
            at(
              `/dashboard/settings/projects/${encodeURIComponent(project.id)}/general`,
            ),
          );
          const generalKey = page.getByRole("textbox", {
            name: "Key",
            exact: true,
          });
          await expect(generalKey).toHaveValue(initialKey);
          await generalKey.fill(renamedKey);
          await expect(
            page.getByText("The key was changed. Confirm to rename it."),
          ).toBeVisible();
          expect(
            (
              await requestJson<Project>(
                page,
                `/api/project/${encodeURIComponent(project.id)}`,
              )
            ).slug,
          ).toBe(initialKey);
          await page.getByRole("button", { name: "Rename key" }).click();
          const confirmation = page.getByRole("alertdialog");
          await expect(confirmation).toBeVisible();
          await expect(confirmation).toContainText(initialKey);
          await expect(confirmation).toContainText(renamedKey);
          expect(
            (
              await requestJson<Project>(
                page,
                `/api/project/${encodeURIComponent(project.id)}`,
              )
            ).slug,
          ).toBe(initialKey);
          await confirmation
            .getByRole("button", { name: "Rename key" })
            .click();
          await expect
            .poll(
              async () =>
                (
                  await requestJson<Project>(
                    page,
                    `/api/project/${encodeURIComponent(project.id)}`,
                  )
                ).slug,
            )
            .toBe(renamedKey);
          await page.reload();
          await expect(generalKey).toHaveValue(renamedKey);
          const newItem = await requestJson<WorkItem>(page, createItemPath, {
            typeId: taskType.id,
            title: "New prefix item",
          });
          expect(newItem.key).toBe(`${renamedKey}-2`);
          expect(
            (
              await requestJson<WorkItem>(
                page,
                `/api/work-items/${encodeURIComponent(originalItem.key)}`,
              )
            ).key,
          ).toBe(originalItem.key);
          await page.goto(
            at(`/agent/work-items/${encodeURIComponent(originalItem.key)}`),
          );
          await expect(page.getByTestId("work-item-detail")).toBeVisible();
          await expect(page.getByTestId("work-item-detail")).toContainText(
            "Original prefix item",
          );
          await page.reload();
          await expect(page.getByTestId("work-item-detail")).toBeVisible();
        } finally {
          await context.close();
        }
      },
      {
        discardChildOutput: true,
        onContainerCreated: (id) => {
          containers.add(id);
        },
      },
    );
  } finally {
    console.info(
      `Project key fixture containers created: ${containers.size ? [...containers].join(", ") : "none"}`,
    );
  }
});
