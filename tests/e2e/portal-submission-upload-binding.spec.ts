import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { APIRequestContext, Page, Route } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  fixtureOwnershipJournal,
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";
import { safePortalOperation } from "./helpers/safe-portal-operation";

/** Source-runtime evidence only: fresh PostgreSQL, private filesystem and real portal sessions. */
const repoRoot = resolve(import.meta.dirname, "../..");
const requireWeb = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { chromium, expect, test } = requireWeb(
  "@playwright/test",
) as typeof import("@playwright/test");
const bytes = Buffer.from("Disposable submission attachment browser test.\n");
const fileName = "browser-evidence.txt";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type Fixture = Pick<
  MfaCsrfAppFixtureSetup,
  "databaseUrl" | "fixtureDir" | "spawnChild"
>;
type PortalPerson = { email: string; password: string };
type IntakeTenant = {
  customer: PortalPerson;
  outsider: PortalPerson;
  requestTypeId: string;
};

async function runPrivate(fixture: Fixture, args: string[], name: string) {
  const child = await fixture.spawnChild(
    process.execPath,
    [resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"), ...args],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    name,
    fixture.fixtureDir,
  );
  await new Promise<void>((resolveClose, reject) => {
    child.once("close", (code) => {
      if (code === 0) resolveClose();
      else reject(new Error(`Private fixture setup failed: ${name}`));
    });
  });
}

async function seedIntake(
  fixture: Fixture,
  input: Record<string, unknown>,
  name: string,
) {
  const inputPath = resolve(fixture.fixtureDir, `${name}-input.json`);
  const outputPath = resolve(fixture.fixtureDir, `${name}-output.json`);
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  await runPrivate(
    fixture,
    [
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, "tests/e2e/scripts/seed-intake-primary.ts"),
      inputPath,
      outputPath,
    ],
    name,
  );
  return JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
}

async function postWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  const csrf = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(csrf.status()).toBe(200);
  const { token } = (await csrf.json()) as { token: string };
  return context.post(new URL(path, origin).toString(), {
    data,
    headers: { Origin: origin, "x-taskdesk-csrf": token },
  });
}

async function signIn(page: Page, origin: string, person: PortalPerson) {
  await page.goto(new URL("/sign-in", origin).toString());
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  const signedIn = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^sign in$/i }).click();
  expect((await signedIn).status()).toBe(200);
  const session = await page
    .context()
    .request.get(new URL("/api/auth/get-session", origin).toString());
  expect(session.status()).toBe(200);
  expect(
    Boolean(((await session.json()) as { session?: unknown } | null)?.session),
  ).toBe(true);
}

async function setupStaff(page: Page, fixture: MfaCsrfAppFixture) {
  await page.goto(new URL("/auth/sign-up", fixture.origin).toString());
  await page.getByLabel("Full name").fill("Disposable upload agent");
  await page.getByLabel("Email").fill(fixture.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  const signup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /^create account$/i }).click();
  expect((await signup).status()).toBe(200);
  const api = page.context().request;
  // D-A: only an instance administrator creates a workspace, and the request names its owner.
  // The signed-in user here is the bootstrap administrator, so they name themselves.
  const sessionResponse = await api.get(
    new URL("/api/auth/get-session", fixture.origin).toString(),
    { headers: { Origin: fixture.origin } },
  );
  expect(sessionResponse.status()).toBe(200);
  const ownerUserId =
    (
      (await sessionResponse.json()) as {
        user?: { id?: string };
      } | null
    )?.user?.id ?? "";
  expect(ownerUserId).toBeTruthy();
  const workspace = await postWithCsrf(api, fixture.origin, "/api/workspace", {
    name: `Upload test ${randomUUID().slice(0, 8)}`,
    ownerUserId,
  });
  expect(workspace.status()).toBe(200);
  const { id: workspaceId } = (await workspace.json()) as { id: string };
  const project = await postWithCsrf(
    page.context().request,
    fixture.origin,
    "/api/project",
    {
      name: "Upload test project",
      workspaceId,
      icon: "Folder",
      slug: uniqueProjectKey(),
    },
  );
  expect(project.status()).toBe(200);
  const { id: projectId } = (await project.json()) as { id: string };
  const types = await page
    .context()
    .request.get(
      new URL(
        `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
        fixture.origin,
      ).toString(),
      { headers: { Origin: fixture.origin } },
    );
  expect(types.status()).toBe(200);
  const [{ id: workItemTypeId }] = (await types.json()) as [{ id: string }];
  return { workspaceId, projectId, workItemTypeId };
}

async function publishFileField(
  page: Page,
  origin: string,
  requestTypeId: string,
  projectId: string,
) {
  await page.goto(
    new URL(
      `/dashboard/settings/workspace/request-types?requestTypeId=${encodeURIComponent(requestTypeId)}`,
      origin,
    ).toString(),
  );
  await expect(page.locator("#request-type-name")).toBeVisible();
  await page.locator("#request-type-name").fill("Disposable upload request");
  await page.locator("#request-type-group").fill("Test requests");
  await page
    .locator("#request-type-description")
    .fill("Disposable browser evidence");
  await page.locator("#request-type-project").fill(projectId);
  await page
    .getByRole("checkbox", { name: "Visible to customers", exact: true })
    .click();
  await page.getByRole("button", { name: "Add field" }).click();
  await page.locator("#field-key-1").fill("evidence");
  await page.locator("#field-label-1").fill("Evidence");
  await page.locator("#field-type-1").click();
  await page.getByRole("option", { name: "File", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/request-types/${encodeURIComponent(requestTypeId)}` &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const published = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/request-types/${encodeURIComponent(requestTypeId)}/publish` &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  expect((await published).status()).toBe(200);
}

test("open submission file upload binds the real customer session", async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(240_000);
  await withMfaCsrfApp(
    async (fixture) => {
      const portal = new URL(fixture.origin);
      portal.hostname = `portal.${portal.hostname}`;
      const browser = await chromium.launch({
        headless: true,
      });
      const staff = await browser.newContext();
      const customer = await browser.newContext({ acceptDownloads: true });
      const outsider = await browser.newContext();
      const anonymous = await browser.newContext();
      try {
        const staffPage = await staff.newPage();
        const support = await setupStaff(staffPage, fixture);
        const tenant = (await seedIntake(
          fixture,
          { phase: "workspace", ...support },
          "submission-upload-tenant",
        )) as IntakeTenant;
        await publishFileField(
          staffPage,
          fixture.origin,
          tenant.requestTypeId,
          support.projectId,
        );
        const customerPage = await customer.newPage();
        const outsiderPage = await outsider.newPage();
        await signIn(customerPage, portal.toString(), tenant.customer);
        await signIn(outsiderPage, portal.toString(), tenant.outsider);
        await customerPage.goto(
          new URL("/catalogue?key=access", portal).toString(),
        );
        await customerPage
          .getByLabel("Summary")
          .fill("Disposable upload request");
        const submission = customerPage.waitForResponse(
          (response: import("@playwright/test").Response) =>
            new URL(response.url()).pathname === "/api/portal/submissions" &&
            response.request().method() === "POST",
        );
        await customerPage
          .getByRole("button", { name: /^submit request$/i })
          .click();
        const created = await submission;
        expect(created.status()).toBe(200);
        const { ref } = (await created.json()) as { ref: string };
        expect(ref).toMatch(/^SUB-[1-9]\d*$/u);
        await expect(customerPage).toHaveURL(
          new RegExp(`/submissions/${ref}$`, "u"),
        );

        let outsiderStatus: number | undefined;
        let anonymousStatus: number | undefined;
        let replayError = false;
        const intercept = async (route: Route) => {
          // Replay before the legitimate request proceeds; never log the signed URL.
          const signedUrl = route.request().url();
          try {
            const options = {
              data: bytes,
              headers: { "content-type": "text/plain" },
            };
            outsiderStatus = (
              await outsider.request.put(signedUrl, options)
            ).status();
            anonymousStatus = (
              await anonymous.request.put(signedUrl, options)
            ).status();
          } catch {
            replayError = true;
          } finally {
            await route.continue();
          }
        };
        await customerPage.route(
          "**/api/storage/portal-attachment-upload?*",
          intercept,
        );
        const presign = customerPage.waitForResponse(
          (response: import("@playwright/test").Response) =>
            new URL(response.url()).pathname ===
              `/api/portal/submissions/${ref}/attachments/presign` &&
            response.request().method() === "POST",
        );
        const put = customerPage.waitForResponse(
          (response: import("@playwright/test").Response) =>
            new URL(response.url()).pathname ===
              "/api/storage/portal-attachment-upload" &&
            response.request().method() === "PUT",
        );
        const complete = customerPage.waitForResponse(
          (response: import("@playwright/test").Response) =>
            new URL(response.url()).pathname.startsWith(
              `/api/portal/submissions/${ref}/attachments/`,
            ) &&
            new URL(response.url()).pathname.endsWith("/complete") &&
            response.request().method() === "POST",
        );
        await customerPage.locator("#submission-file-evidence").setInputFiles({
          name: fileName,
          mimeType: "text/plain",
          buffer: bytes,
        });
        expect((await presign).status()).toBe(200);
        expect((await put).status()).toBe(204);
        expect((await complete).status()).toBe(200);
        expect(replayError).toBe(false);
        expect(outsiderStatus).toBe(400);
        expect(anonymousStatus).toBe(401);
        await customerPage.unroute(
          "**/api/storage/portal-attachment-upload?*",
          intercept,
        );
        await customerPage.reload();
        await expect(
          customerPage.getByText(fileName, { exact: true }).first(),
        ).toBeVisible();
        const list = await customer.request.get(
          new URL(
            `/api/portal/submissions/${ref}/attachments`,
            portal,
          ).toString(),
        );
        expect(list.status()).toBe(200);
        const rows = (await list.json()) as Array<{
          id: string;
          filename: string;
          state: string;
          downloadable: boolean;
        }>;
        const row = rows.find((item) => item.filename === fileName);
        expect(row?.state).toBe("ready");
        expect(row?.downloadable).toBe(true);
        if (!row) throw new Error("Completed attachment was not listed");
        const download = await safePortalOperation(() =>
          customer.request.get(
            new URL(
              `/api/portal/submissions/${ref}/attachments/${row.id}`,
              portal,
            ).toString(),
          ),
        );
        expect(download.status()).toBe(200);
        expect(
          Buffer.from(await safePortalOperation(() => download.body())).equals(
            bytes,
          ),
        ).toBe(true);
        const issuance = await safePortalOperation(() =>
          customer.request.get(
            new URL(
              `/api/portal/submissions/${ref}/attachments/${row.id}`,
              portal,
            ).toString(),
            { maxRedirects: 0 },
          ),
        );
        expect(issuance.status()).toBe(302);
        const location = issuance.headers().location;
        expect(location).toBeTruthy();
        if (!location) throw new Error("Portal download redirect is missing.");
        const issuedUrl = new URL(location, portal);
        expect(issuedUrl.origin).toBe(portal.origin);
        expect(issuedUrl.pathname).toBe("/api/storage/portal-download");
        const expiry = Number(issuedUrl.searchParams.get("expires"));
        expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(expiry).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 300);
        const head = await safePortalOperation(() =>
          customer.request.head(issuedUrl.toString()),
        );
        expect(head.status()).toBe(200);
        expect(head.headers()["content-length"]).toBe(String(bytes.length));
        expect((await safePortalOperation(() => head.body())).length).toBe(0);
        const range = await safePortalOperation(() =>
          customer.request.get(issuedUrl.toString(), {
            headers: { Range: "bytes=1-4" },
          }),
        );
        expect(range.status()).toBe(206);
        expect(range.headers()["content-range"]).toBe(
          `bytes 1-4/${bytes.length}`,
        );
        expect(
          Buffer.from(await safePortalOperation(() => range.body())).equals(
            bytes.subarray(1, 5),
          ),
        ).toBe(true);
        const invalidRange = await safePortalOperation(() =>
          customer.request.get(issuedUrl.toString(), {
            headers: { Range: `bytes=${bytes.length}-` },
          }),
        );
        expect(invalidRange.status()).toBe(416);
        expect(invalidRange.headers()["content-range"]).toBe(
          `bytes */${bytes.length}`,
        );
        expect(
          (
            await safePortalOperation(() =>
              outsider.request.get(issuedUrl.toString()),
            )
          ).status(),
        ).toBe(400);
        const wrongHost = new URL(issuedUrl);
        wrongHost.host = new URL(fixture.origin).host;
        expect(
          (
            await safePortalOperation(() =>
              customer.request.get(wrongHost.toString()),
            )
          ).status(),
        ).toBe(404);
        for (const width of [390, 820, 1280]) {
          for (const colorScheme of ["light", "dark"] as const) {
            await customerPage.setViewportSize({ width, height: 900 });
            await customerPage.emulateMedia({ colorScheme });
            if (width >= 768) {
              const sidebar = customerPage.locator(
                '[data-slot="sidebar-container"]',
              );
              await expect(sidebar).toBeVisible();
              await expect(sidebar).toHaveCSS("left", "0px");
              await expect(
                sidebar.locator('[data-slot="sidebar-inner"]'),
              ).toBeVisible();
            }
            await expect(customerPage.locator("html")).toHaveClass(
              new RegExp(`\\b${colorScheme}\\b`, "u"),
            );
            await expect(
              customerPage.getByText(fileName, { exact: true }).first(),
            ).toBeVisible();
            expect(
              await customerPage.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await customerPage.screenshot({
              path: info.outputPath(
                `submission-upload-${width}-${colorScheme}.png`,
              ),
              fullPage: true,
            });
          }
        }
      } finally {
        await Promise.allSettled([
          staff.close(),
          customer.close(),
          outsider.close(),
          anonymous.close(),
        ]);
        await browser.close();
      }
    },
    {
      discardChildOutput: true,
      ...fixtureOwnershipJournal(info.outputPath("fixture-ownership.jsonl")),
      beforeStart: async (fixture) => {
        await runPrivate(
          fixture,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "submission-upload-auth-provider",
        );
        await seedIntake(
          fixture,
          { phase: "instance" },
          "submission-upload-instance",
        );
        const portalInput = resolve(
          fixture.fixtureDir,
          "submission-upload-portal-input.json",
        );
        const portalOutput = resolve(
          fixture.fixtureDir,
          "submission-upload-portal-output.json",
        );
        writeFileSync(portalInput, JSON.stringify({ phase: "instance" }), {
          mode: 0o600,
        });
        await runPrivate(
          fixture,
          [
            "--tsconfig",
            resolve(repoRoot, "apps/api/tsconfig.tests.json"),
            resolve(repoRoot, "tests/e2e/scripts/seed-portal-projects.ts"),
            portalInput,
            portalOutput,
          ],
          "submission-upload-portal",
        );
        expect(JSON.parse(readFileSync(portalOutput, "utf8"))).toEqual({
          feature: "feature.customer_portal",
        });
      },
    },
  );
});
