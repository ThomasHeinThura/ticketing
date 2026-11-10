import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seriousOrCriticalViolations } from "../../apps/web/e2e/helpers/axe";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { fillSensitive, privateRequest } from "./helpers/fill-sensitive";
import { totpForUri, withMfaCsrfApp } from "./helpers/mfa-csrf-app-fixture";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(resolve(root, "apps/web/package.json"));
const requireApi = createRequire(resolve(root, "apps/api/package.json"));
const { chromium, expect, test } = requireWeb(
  "@playwright/test",
) as typeof import("@playwright/test");
const { Client } = requireApi("pg") as typeof import("pg");

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

test("first administrator completes authenticator enrollment in the browser", async () => {
  test.setTimeout(360_000);
  await withMfaCsrfApp(
    async ({ origin, email, password, databaseUrl }) => {
      const db = new Client({ connectionString: databaseUrl });
      await db.connect();
      try {
        const state = async () => {
          const result = await db.query<{ users: number; completed: number }>(
            'SELECT (SELECT count(*)::int FROM "user") AS users, (SELECT count(*)::int FROM instance_setting WHERE setup_completed_at IS NOT NULL) AS completed',
          );
          return result.rows[0];
        };
        expect(await state()).toEqual({ users: 0, completed: 0 });
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({
            locale: "en-GB",
            serviceWorkers: "block",
          });
          try {
            const page = await context.newPage();
            await page.goto(`${origin}/auth/sign-up`);
            await page.locator('input[name="name"]').fill("Bootstrap browser");
            await fillSensitive(page.locator('input[name="email"]'), email);
            await fillSensitive(
              page.locator('input[name="password"]'),
              password,
            );
            const signup = page.waitForResponse(
              (r) =>
                new URL(r.url()).pathname === "/api/auth/sign-up/email" &&
                r.request().method() === "POST",
            );
            await page.locator('form button[type="submit"]').click();
            expect((await signup).status()).toBe(200);
            await expect(page).toHaveURL(
              /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/,
              { timeout: 30_000 },
            );
            expect(await state()).toEqual({ users: 1, completed: 0 });
            const protectedRequest = () =>
              privateRequest(() =>
                context.request.get(`${origin}/api/instance/users`, {
                  headers: { Origin: origin },
                }),
              );
            const denied = await protectedRequest();
            expect(denied.status()).toBe(403);
            expect((await denied.text()).trim()).toBe(
              "mfa_enrollment_required",
            );
            await expect(
              page.getByRole("button", { name: "Set up authenticator" }),
            ).toBeVisible();
            const violations = await seriousOrCriticalViolations(page);
            expect(
              violations.length,
              "Pending enrollment fails G4 axe checks",
            ).toBe(0);
            await fillSensitive(page.locator("#factor-password"), password);
            const enabled = page.waitForResponse(
              (r) =>
                new URL(r.url()).pathname === "/api/auth/two-factor/enable" &&
                r.request().method() === "POST",
            );
            await page
              .getByRole("button", { name: "Set up authenticator" })
              .click();
            const response = await enabled;
            expect(response.status()).toBe(200);
            const { totpURI } = (await response.json()) as { totpURI: string };
            expect(await state()).toEqual({ users: 1, completed: 0 });
            const stillDenied = await protectedRequest();
            expect(stillDenied.status()).toBe(403);
            expect((await stillDenied.text()).trim()).toBe(
              "mfa_enrollment_required",
            );
            const code = page.locator("#enrollment-code");
            const verify = page.getByRole("button", {
              name: "Verify and enable",
            });
            const forbidden = new Set(
              [-60_000, -30_000, 0, 30_000, 60_000].map((offset) =>
                totpForUri(totpURI, Date.now() + offset),
              ),
            );
            const invalid = [
              "000000",
              "111111",
              "222222",
              "333333",
              "444444",
              "555555",
            ].find((value) => !forbidden.has(value));
            if (!invalid)
              throw new Error("Could not choose an invalid test code.");
            await code.fill(invalid);
            await code.focus();
            await page.keyboard.press("Tab");
            await expect(verify).toBeFocused();
            const rejected = page.waitForResponse(
              (r) =>
                new URL(r.url()).pathname ===
                  "/api/auth/two-factor/verify-totp" &&
                r.request().method() === "POST",
            );
            await page.keyboard.press("Enter");
            expect((await rejected).status()).toBe(401);
            const error = page.getByText(
              "The authenticator code was not accepted. Check the current code and retry.",
            );
            await expect(error).toBeVisible();
            expect(await state()).toEqual({ users: 1, completed: 0 });
            for (const width of [390, 834, 1440]) {
              for (const theme of ["light", "dark"]) {
                await page.setViewportSize({ width, height: 900 });
                // Injected class checks responsive layout; this does not test the theme picker.
                await page.evaluate((value) => {
                  document.documentElement.classList.remove("light", "dark");
                  document.documentElement.classList.add(value);
                }, theme);
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                for (const control of [error, code, verify]) {
                  await expect(control).toBeVisible();
                  const box = await control.boundingBox();
                  expect(box).not.toBeNull();
                  if (!box)
                    throw new Error("Enrollment control has no layout box.");
                  expect(box.x).toBeGreaterThanOrEqual(0);
                  expect(box.x + box.width).toBeLessThanOrEqual(width);
                }
                const dimensions = await page.evaluate(() => ({
                  viewport: document.documentElement.clientWidth,
                  content: document.documentElement.scrollWidth,
                }));
                expect(dimensions.content).toBeLessThanOrEqual(
                  dimensions.viewport,
                );
              }
            }
            await fillSensitive(code, totpForUri(totpURI));
            const verified = page.waitForResponse(
              (r) =>
                new URL(r.url()).pathname ===
                  "/api/auth/two-factor/verify-totp" &&
                r.request().method() === "POST",
            );
            await verify.click();
            expect((await verified).status()).toBe(200);
            expect(await state()).toEqual({ users: 1, completed: 1 });
            expect((await protectedRequest()).status()).toBe(200);
            const saved = page.getByRole("button", {
              name: "I saved these codes",
            });
            await expect(saved).toBeVisible();
            const backupCodes = page.locator("ul.font-mono li");
            await expect.poll(() => backupCodes.first().isVisible()).toBe(true);
            await saved.click();
            await expect(saved).toHaveCount(0);
            await expect.poll(() => backupCodes.count()).toBe(0);
            await expect(
              page.getByRole("heading", {
                name: "Authenticator factor enabled",
              }),
            ).toBeVisible();
            await page.reload();
            await expect(
              page.getByRole("heading", {
                name: "Authenticator factor enabled",
              }),
            ).toBeVisible();
            expect(await state()).toEqual({ users: 1, completed: 1 });
            expect((await protectedRequest()).status()).toBe(200);
            // The pending settings shell has no theme control. Exercise the actual
            // preferences control after enrollment, then reload the security page.
            for (const width of [390, 834, 1440]) {
              await page.setViewportSize({ width, height: 900 });
              for (const theme of ["light", "dark"] as const) {
                await page.goto(
                  `${origin}/dashboard/settings/account/preferences`,
                );
                await page.locator("#preference-theme").click();
                await page
                  .getByRole("option", {
                    name: theme === "light" ? "Light" : "Dark",
                    exact: true,
                  })
                  .click();
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                await page.goto(
                  `${origin}/dashboard/settings/account/security`,
                );
                await page.reload();
                await expect(page.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                await expect(
                  page.getByRole("heading", {
                    name: "Authenticator factor enabled",
                  }),
                ).toBeVisible();
              }
            }
          } finally {
            await context.close();
          }
        } finally {
          await browser.close();
        }
      } finally {
        await db.end();
      }
    },
    { discardChildOutput: true },
  );
});
