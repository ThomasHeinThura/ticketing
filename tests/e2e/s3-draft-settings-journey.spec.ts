import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { completePendingFirstAdminInBrowser } from "./helpers/complete-bootstrap-enrollment";
import { fillSensitive } from "./helpers/fill-sensitive";
import { withMfaCsrfApp } from "./helpers/mfa-csrf-app-fixture";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const { expect, test } = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { Client } = apiRequire("pg") as typeof import("pg");

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const types: Record<string, string> = {
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
    if (url.pathname.startsWith("/api/") || request.method() !== "GET")
      return route.continue();
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
    return route.fulfill({
      body: await readFile(target),
      contentType: types[extname(target)] ?? "application/octet-stream",
    });
  });
}

type S3Fixture = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};
function fixtureConfig(value: unknown): S3Fixture {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("s3Fixture metadata is required");
  const data = value as Record<string, unknown>;
  const keys = ["accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"];
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((key) => typeof data[key] !== "string" || !data[key])
  )
    throw new Error("Invalid s3Fixture metadata");
  const url = new URL(data.publicBaseUrl as string);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".test") ||
    url.origin !== data.publicBaseUrl
  )
    throw new Error(
      "s3Fixture publicBaseUrl must be a synthetic HTTPS .test origin",
    );
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(data.bucket as string))
    throw new Error("Invalid s3Fixture bucket");
  return data as S3Fixture;
}

test("bundled S3 draft saves and probes a disposable SeaweedFS through real step-up", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const synthetic = fixtureConfig(testInfo.config.metadata.s3Fixture);
  const distValue: unknown = testInfo.config.metadata.storageAgentDist;
  if (distValue !== undefined && typeof distValue !== "string")
    throw new Error("storageAgentDist metadata must be a path string");
  const dist = resolve(distValue ?? resolve(root, "apps/web/dist/agent"));
  await withMfaCsrfApp(
    async (fixture) => {
      const context = await browser.newContext({
        locale: "en-GB",
        reducedMotion: "reduce",
      });
      const database = new Client({ connectionString: fixture.databaseUrl });
      try {
        await database.connect();
        const page = await context.newPage();
        const browserErrors: string[] = [];
        page.on("pageerror", () => browserErrors.push("pageerror"));
        page.on("console", (message) => {
          if (message.type() === "error") browserErrors.push("console error");
        });
        const responses: string[] = [];
        page.on("response", (response) => {
          const path = new URL(response.url()).pathname;
          if (
            response.request().method() === "POST" &&
            (path === "/api/me/step-up" ||
              path === "/api/me/step-up/challenges")
          )
            responses.push(`${path}:${response.status()}`);
        });
        await serveAgentBuild(page, fixture.origin, dist);
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
        const nextBackupCode = await completePendingFirstAdminInBrowser(
          page,
          fixture,
        );
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
        const beforeUsage = await before.json();
        expect(beforeUsage.backend).toMatchObject({
          driver: "filesystem",
          source: "bootstrap",
        });
        const storageRoot = resolve(fixture.fixtureDir, "attachments");
        expect(await readdir(storageRoot)).toEqual([]);
        await page.goto(
          new URL("/god-mode/storage", fixture.origin).toString(),
        );
        await expect(
          page.getByText("S3 / SeaweedFS configuration draft"),
        ).toBeVisible();
        await page.locator("#s3-connector").click();
        await page.getByRole("option", { name: "Bundled SeaweedFS" }).click();
        await page.locator("#s3-publicBaseUrl").fill(synthetic.publicBaseUrl);
        await page.locator("#s3-region").fill("us-east-1");
        await page.locator("#s3-bucket").fill(synthetic.bucket);
        await page.locator("#s3-keyPrefix").fill("browser-journey/");
        await page.locator("#s3-access-mode").click();
        await page.getByRole("option", { name: "Replace" }).click();
        await page.locator("#s3-access-value").fill(synthetic.accessKeyId);
        await page.locator("#s3-secret-mode").click();
        await page.getByRole("option", { name: "Replace" }).click();
        await page.locator("#s3-secret-value").fill(synthetic.secretAccessKey);
        await page.locator("#s3-draft-step-up-method").click();
        await page.getByRole("option", { name: "Backup code" }).click();
        await fillSensitive(
          page.locator("#s3-draft-step-up-secret"),
          nextBackupCode(),
        );
        const saved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/instance/storage/s3-draft" &&
            response.request().method() === "PUT",
        );
        const save = page.getByRole("button", { name: "Save draft" });
        await save.focus();
        await expect(save).toBeFocused();
        await page.keyboard.press("Enter");
        const savedResponse = await saved;
        expect(savedResponse.status()).toBe(200);
        const savedBody = await savedResponse.json();
        expect(savedBody).toMatchObject({
          version: 1,
          config: { connector: "bundled_seaweedfs", bucket: synthetic.bucket },
          credentialConfigured: true,
          accessKeyIdConfigured: true,
          secretAccessKeyConfigured: true,
        });
        expect(JSON.stringify(savedBody)).not.toContain(synthetic.accessKeyId);
        expect(JSON.stringify(savedBody)).not.toContain(
          synthetic.secretAccessKey,
        );
        await expect(page.getByText("Draft saved")).toBeVisible();
        await page.reload();
        await expect(page.locator("#s3-bucket")).toHaveValue(synthetic.bucket);
        await expect(page.locator("#s3-access-mode")).toContainText(
          "Keep existing",
        );
        await expect(page.locator("#s3-secret-mode")).toContainText(
          "Keep existing",
        );
        await expect(
          page.getByText(/Access key ID — Configured/),
        ).toBeVisible();
        await expect(
          page.getByText(/Secret access key — Configured/),
        ).toBeVisible();
        await expect(
          page.locator("#s3-access-value, #s3-secret-value"),
        ).toHaveCount(0);
        const getDraft = await context.request.get(
          new URL("/api/instance/storage/s3-draft", fixture.origin).toString(),
        );
        expect(getDraft.status()).toBe(200);
        expect(await getDraft.json()).toMatchObject({
          version: 1,
          credentialConfigured: true,
        });
        await page.locator("#s3-draft-step-up-method").click();
        await page.getByRole("option", { name: "Backup code" }).click();
        await fillSensitive(
          page.locator("#s3-draft-step-up-secret"),
          nextBackupCode(),
        );
        const tested = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/instance/storage/s3-draft/test" &&
            response.request().method() === "POST",
        );
        const testButton = page.getByRole("button", { name: "Test draft" });
        await testButton.focus();
        await expect(testButton).toBeFocused();
        await page.keyboard.press("Enter");
        const testResponse = await tested;
        expect(testResponse.status()).toBe(200);
        expect(await testResponse.json()).toMatchObject({
          status: "verified",
          cleanup: "not_attempted",
          diagnosticObjectMayRemain: true,
          browserPathVerified: false,
        });
        const outcome = page
          .getByRole("alert")
          .filter({ hasText: "Storage write and read verified" });
        await expect(outcome).toContainText("not verified (not attempted)");
        await expect(outcome).toContainText(
          "A diagnostic object may remain in storage.",
        );
        await expect(outcome).toContainText(
          "Browser upload and download are not verified",
        );
        expect(responses).toEqual([
          "/api/me/step-up/challenges:200",
          "/api/me/step-up:200",
          "/api/me/step-up/challenges:200",
          "/api/me/step-up:200",
        ]);
        const audit = await database.query(
          "SELECT count(*)::int AS count FROM audit_log WHERE action = 'plugin.tested' AND entity_type = 'instance_plugin_config'",
        );
        expect(audit.rows[0]?.count).toBe(1);
        const proofs = await database.query(
          "SELECT operation_key, count(*)::int AS count FROM step_up_confirmation WHERE state = 'consumed' AND consumed_at IS NOT NULL AND operation_key IN ('storage_config_save', 'storage_config_test') GROUP BY operation_key ORDER BY operation_key",
        );
        expect(proofs.rows).toEqual([
          { operation_key: "storage_config_save", count: 1 },
          { operation_key: "storage_config_test", count: 1 },
        ]);
        const after = await context.request.get(usageUrl);
        expect(after.status()).toBe(200);
        const afterUsage = await after.json();
        expect(afterUsage.backend).toMatchObject({
          driver: "filesystem",
          source: "bootstrap",
        });
        expect(afterUsage.attachments).toEqual(beforeUsage.attachments);
        expect(await readdir(storageRoot)).toEqual([]);
        await expect(page.locator("#s3-draft-step-up-secret")).toHaveValue("");
        await expect(
          page.locator("#s3-access-value, #s3-secret-value"),
        ).toHaveCount(0);
        const outcomeText = await page.locator("body").innerText();
        expect(outcomeText).not.toContain(synthetic.accessKeyId);
        expect(outcomeText).not.toContain(synthetic.secretAccessKey);
        expect(outcomeText).not.toContain(fixture.password);
        await testInfo.attach("s3-draft-probe-result", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        for (const width of [375, 820, 1440]) {
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
            await expect(page.locator("#s3-bucket")).toHaveValue(
              synthetic.bucket,
            );
            await expect(page.locator("#s3-draft-step-up-secret")).toHaveValue(
              "",
            );
            await expect(
              page.locator("#s3-access-value, #s3-secret-value"),
            ).toHaveCount(0);
            const text = await page.locator("body").innerText();
            expect(text).not.toContain(synthetic.accessKeyId);
            expect(text).not.toContain(synthetic.secretAccessKey);
            expect(text).not.toContain(fixture.password);
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
              ),
            ).toBe(true);
            await page
              .getByText("S3 / SeaweedFS configuration draft", { exact: true })
              .evaluate((element) =>
                element.scrollIntoView({ block: "start" }),
              );
            await testInfo.attach(`s3-draft-${width}-${theme}`, {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
            await page
              .getByRole("button", { name: "Save draft", exact: true })
              .scrollIntoViewIfNeeded();
            await testInfo.attach(`s3-draft-verification-${width}-${theme}`, {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
        }
        expect(browserErrors).toEqual([]);
      } finally {
        await database.end();
        await context.close();
      }
    },
    { discardChildOutput: true },
  );
});
