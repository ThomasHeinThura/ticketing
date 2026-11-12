import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { completePendingFirstAdminInBrowser } from "./helpers/complete-bootstrap-enrollment";
import { withMfaCsrfApp } from "./helpers/mfa-csrf-app-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { expect, test } = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function serveAgentBuild(page: Page, origin: string, dist: string) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    // All API calls go to the fixture's actual HTTP server, with browser cookies and CSRF.
    if (url.pathname.startsWith("/api/")) return route.continue();
    if (request.method() !== "GET") return route.continue();
    const path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (path !== dist && !path.startsWith(`${dist}${sep}`))
      return route.abort();
    let target = path;
    try {
      if (!(await stat(path)).isFile()) target = resolve(dist, "index.html");
    } catch {
      if (extname(path))
        return route.fulfill({ status: 404, body: "Not found" });
      target = resolve(dist, "index.html");
    }
    const body = await readFile(target);
    return route.fulfill({
      body,
      contentType: contentTypes[extname(target)] ?? "application/octet-stream",
    });
  });
}

test("storage probe retains a diagnostic object on the real filesystem @a11y", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const configuredDist: unknown = testInfo.config.metadata.storageAgentDist;
  if (configuredDist !== undefined && typeof configuredDist !== "string")
    throw new Error("storageAgentDist metadata must be a path string");
  const dist = resolve(
    configuredDist ?? resolve(repoRoot, "apps/web/dist/agent"),
  );
  await withMfaCsrfApp(
    async (fixture) => {
      const context = await browser.newContext({
        locale: "en-GB",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await serveAgentBuild(page, fixture.origin, dist);
        let postCount = 0;
        page.on("request", (request) => {
          if (
            request.method() === "POST" &&
            new URL(request.url()).pathname === "/api/instance/storage/test"
          )
            postCount += 1;
        });
        await page.goto(new URL("/auth/sign-up", fixture.origin).toString());
        await page
          .getByLabel("Full name")
          .fill("Storage journey administrator");
        await page.getByLabel("Email").fill(fixture.email);
        await page
          .locator('input[autocomplete="new-password"]')
          .fill(fixture.password);
        const signup = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Create account" }).click();
        expect((await signup).status()).toBe(200);
        await completePendingFirstAdminInBrowser(page, fixture);
        await page.goto(new URL("/onboarding", fixture.origin).toString());
        await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
        await page
          .getByLabel("Workspace name")
          .fill("Storage journey workspace");
        await page.getByRole("button", { name: "Create workspace" }).click();
        await expect(page).toHaveURL(/\/dashboard\/workspace\//);

        const usageUrl = new URL(
          "/api/instance/storage/usage",
          fixture.origin,
        ).toString();
        const before = await context.request.get(usageUrl);
        expect(before.status()).toBe(200);
        const beforeUsage = (await before.json()) as { attachments: unknown };
        const storageRoot = resolve(fixture.fixtureDir, "attachments");
        expect((await readdir(storageRoot)).length).toBe(0);
        await page.goto(
          new URL("/god-mode/storage", fixture.origin).toString(),
        );
        await expect(
          page.getByText(
            /Each test attempts to write a small diagnostic object/,
          ),
        ).toBeVisible();
        expect(postCount).toBe(0);
        const probe = page.getByRole("button", { name: "Run storage probe" });
        const probeResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/instance/storage/test" &&
            response.request().method() === "POST",
        );
        await probe.focus();
        await expect(probe).toBeFocused();
        await page.keyboard.press("Enter");
        const response = await probeResponse;
        expect(response.status()).toBe(200);
        expect(
          Boolean(await response.request().headerValue("x-taskdesk-csrf")),
        ).toBe(true);
        expect(await response.json()).toMatchObject({
          status: "verified",
          cleanup: "not_attempted",
          diagnosticObjectMayRemain: true,
        });
        const outcome = page
          .getByRole("alert")
          .filter({ hasText: "Storage write and read verified" });
        await expect(outcome).toContainText(
          "Cleanup: not verified (not attempted)",
        );
        await expect(outcome).toContainText(
          "A diagnostic object may remain in storage.",
        );
        await expect(outcome).toHaveClass(/border-warning/);
        const files = await readdir(storageRoot);
        expect(files.length).toBe(1);
        const retainedFile = files[0];
        if (!retainedFile)
          throw new Error("Diagnostic object was not retained");
        const retained = await stat(resolve(storageRoot, retainedFile));
        expect(retained.isFile()).toBe(true);
        expect(retained.size).toBe(32);
        const after = await context.request.get(usageUrl);
        expect(after.status()).toBe(200);
        const afterUsage = (await after.json()) as { attachments: unknown };
        expect(afterUsage.attachments).toEqual(beforeUsage.attachments);
        await testInfo.attach("storage-probe-verified", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });

        // A second immediate request is rejected by the real limiter and cannot write another object.
        const retryResponse = page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname ===
              "/api/instance/storage/test" &&
            candidate.request().method() === "POST",
        );
        await probe.click();
        expect((await retryResponse).status()).toBe(429);
        await expect(
          page.getByText(
            "The probe request failed. Review the result and try again.",
          ),
        ).toBeVisible();
        expect((await readdir(storageRoot)).length).toBe(1);
        expect(postCount).toBe(2);
        await page.reload();
        await expect(
          page.getByText(
            /Each test attempts to write a small diagnostic object/,
          ),
        ).toBeVisible();
        expect(postCount).toBe(2);

        for (const width of [390, 820, 1440]) {
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
            }, theme);
            await page.reload();
            await expect(page.locator("html")).toHaveClass(
              new RegExp(`\\b${theme}\\b`),
            );
            await expect(
              page.getByText(
                /Each test attempts to write a small diagnostic object/,
              ),
            ).toBeVisible();
            await expect(
              page.getByRole("button", { name: "Run storage probe" }),
            ).toBeVisible();
            expect(postCount).toBe(2);
            await testInfo.attach(`storage-${width}-${theme}`, {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
        }
      } finally {
        await context.close();
      }
    },
    { discardChildOutput: true },
  );
});
