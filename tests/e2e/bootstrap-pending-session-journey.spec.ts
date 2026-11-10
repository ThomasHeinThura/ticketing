import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { totpForUri, withMfaCsrfApp } from "./helpers/mfa-csrf-app-fixture";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const requireWeb = createRequire(resolve(root, "apps/web/package.json"));
const { chromium, expect, test } = requireWeb(
  "@playwright/test",
) as typeof import("@playwright/test");
const security = "/dashboard/settings/account/security";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, info) =>
  redactSecretErrorContext(info),
);

test("pending bootstrap stays restricted across navigation, reload and re-entry", async () => {
  test.setTimeout(360_000);
  await withMfaCsrfApp(
    async ({ origin, email, password, fixtureDir }) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          locale: "en-GB",
          serviceWorkers: "block",
        });
        try {
          const page = await context.newPage();
          const post = (path: string, data: object) =>
            context.request.post(`${origin}${path}`, {
              headers: { Origin: origin },
              data,
            });
          const signup = await post("/api/auth/sign-up/email", {
            name: "Bootstrap browser",
            email,
            password,
          });
          expect(signup.status()).toBe(200);
          const assertRestricted = async () => {
            const response = await context.request.get(
              `${origin}/api/instance/users`,
              { headers: { Origin: origin } },
            );
            expect(response.status()).toBe(403);
            expect((await response.text()).trim()).toBe(
              "mfa_enrollment_required",
            );
          };
          const assertMandatory = async () => {
            await expect(
              page.getByRole("heading", { name: "Account security" }),
            ).toBeVisible();
            await expect(
              page.getByText(
                "Instance policy requires you to enroll a factor before continuing.",
              ),
            ).toBeVisible();
            await expect(
              page.getByRole("button", { name: "Set up authenticator" }),
            ).toBeVisible();
            await expect(
              page.getByText("Connected sign-in methods", { exact: true }),
            ).toHaveCount(0);
          };
          await assertRestricted();
          await page.goto(`${origin}/god-mode/users`);
          await expect(page).toHaveURL(
            /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/,
          );
          await page.reload();
          await assertMandatory();
          await page.goto(`${origin}${security}`);
          await expect(page).toHaveURL(
            (url) =>
              url.pathname === security &&
              !url.searchParams.has("enrollmentRequired"),
          );
          await assertMandatory();
          expect((await post("/api/auth/sign-out", {})).status()).toBe(200);
          await page.goto(`${origin}/god-mode/users`);
          await expect(page).toHaveURL(/\/god-mode\/sign-in/);
          expect(
            (
              await post("/api/auth/sign-in/email", { email, password })
            ).status(),
          ).toBe(200);
          await page.goto(`${origin}/god-mode/users`);
          await expect(page).toHaveURL(
            /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/,
          );
          await assertRestricted();
          await page.goto(`${origin}${security}`);
          await assertMandatory();
          await page.locator("#factor-password").fill(password);
          const enable = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                "/api/auth/two-factor/enable" &&
              response.request().method() === "POST",
          );
          await page
            .getByRole("button", { name: "Set up authenticator" })
            .click();
          const enabled = await enable;
          expect(enabled.status()).toBe(200);
          const enrollment = (await enabled.json()) as { totpURI: string };
          const forbidden = new Set(
            [-60_000, -30_000, 0, 30_000, 60_000].map((offset) =>
              totpForUri(enrollment.totpURI, Date.now() + offset),
            ),
          );
          const invalid = [
            "000000",
            "111111",
            "222222",
            "333333",
            "444444",
            "555555",
          ].find((code) => !forbidden.has(code));
          if (!invalid)
            throw new Error("Could not choose an invalid test code.");
          const code = page.locator("#enrollment-code");
          await expect(code).toBeVisible();
          await code.focus();
          await expect(code).toBeFocused();
          await page.keyboard.type(invalid);
          await page.keyboard.press("Tab");
          const verify = page.getByRole("button", {
            name: "Verify and enable",
          });
          await expect(verify).toBeFocused();
          const rejected = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                "/api/auth/two-factor/verify-totp" &&
              response.request().method() === "POST",
          );
          await page.keyboard.press("Enter");
          expect((await rejected).status()).toBe(401);
          const error = page.getByText(
            "The authenticator code was not accepted. Check the current code and retry.",
          );
          await expect(error).toBeVisible();
          await assertRestricted();
          for (const width of [390, 834, 1440]) {
            for (const theme of ["light", "dark"] as const) {
              await page.setViewportSize({ width, height: 900 });
              await page.evaluate((value) => {
                const stored = JSON.parse(
                  localStorage.getItem("user-preferences") ?? "{}",
                ) as { state?: Record<string, unknown>; version?: number };
                localStorage.setItem(
                  "user-preferences",
                  JSON.stringify({
                    ...stored,
                    state: { ...stored.state, theme: value },
                    version: stored.version ?? 0,
                  }),
                );
                document.documentElement.classList.remove("light", "dark");
                document.documentElement.classList.add(value);
              }, theme);
              await expect(page.locator("html")).toHaveClass(
                new RegExp(`\\b${theme}\\b`),
              );
              await expect(error).toBeVisible();
              await expect(code).toBeVisible();
              await code.focus();
              await expect(code).toBeFocused();
              await page.keyboard.press("Tab");
              await expect(verify).toBeFocused();
              const layout = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
              }));
              expect(layout.content).toBeLessThanOrEqual(layout.viewport);
              for (const control of [error, code, verify]) {
                const box = await control.boundingBox();
                expect(box).not.toBeNull();
                if (!box)
                  throw new Error("Security control has no layout box.");
                expect(box.x).toBeGreaterThanOrEqual(0);
                expect(box.x + box.width).toBeLessThanOrEqual(width);
              }
              // This private fixture directory is removed on teardown. Mask every
              // input, code block and possible QR surface before pixels are saved.
              await page.screenshot({
                path: resolve(fixtureDir, `pending-${width}-${theme}.png`),
                fullPage: true,
                mask: [page.locator("input, textarea, code, canvas, svg")],
              });
            }
          }
          await page.goto(`${origin}${security}`);
          await assertMandatory();
          await assertRestricted();
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    },
    { discardChildOutput: true },
  );
});
