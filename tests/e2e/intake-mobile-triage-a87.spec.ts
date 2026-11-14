import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { completePendingFirstAdminInBrowser } from "./helpers/complete-bootstrap-enrollment";
import {
  fixtureOwnershipJournal,
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  navigateToSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";

/** Source-runtime evidence only: fresh PostgreSQL, private filesystem and real portal sessions. */
const repoRoot = resolve(import.meta.dirname, "../..");
const requireWeb = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { chromium, expect, test } = requireWeb(
  "@playwright/test",
) as typeof import("@playwright/test");
const actionTimeout = 15_000;
const operationTimeout = 30_000;

test.use({ trace: "off", video: "off", screenshot: "off" });
test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type SafePhase =
  | "staff-email"
  | "staff-password"
  | "customer-email"
  | "customer-password"
  | "staff-setup"
  | "customer-sign-in"
  | "authenticated-api"
  | "browser-journey";

class SafeFailure extends Error {}

async function safe<T>(phase: SafePhase, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    throw new SafeFailure(`A87 ${phase} failed.`);
  }
}

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
  audience: "agent" | "customer",
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  return safe("authenticated-api", async () => {
    if (new URL(origin).origin !== origin)
      throw new Error("A87 request origin must be canonical.");
    const csrfPath =
      audience === "agent" ? "/api/me/csrf-token" : "/api/portal/csrf-token";
    const csrf = await context.get(new URL(csrfPath, origin).toString(), {
      headers: { Origin: origin },
      timeout: operationTimeout,
    });
    expect(csrf.status()).toBe(200);
    const { token } = (await csrf.json()) as { token: string };
    return context.post(new URL(path, origin).toString(), {
      data,
      headers: { Origin: origin, "x-taskdesk-csrf": token },
      timeout: operationTimeout,
    });
  });
}

async function signIn(page: Page, origin: string, person: PortalPerson) {
  return safe("customer-sign-in", async () => {
    page.setDefaultTimeout(actionTimeout);
    page.setDefaultNavigationTimeout(operationTimeout);
    await page.goto(new URL("/sign-in", origin).toString());
    await safe("customer-email", () =>
      page.getByLabel("Email").fill(person.email),
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await safe("customer-password", () =>
      page.getByLabel("Password", { exact: true }).fill(person.password),
    );
    const [signedIn] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
          response.request().method() === "POST",
        { timeout: operationTimeout },
      ),
      page.getByRole("button", { name: /^sign in$/i }).click(),
    ]);
    expect(signedIn.status()).toBe(200);
    const session = await page
      .context()
      .request.get(new URL("/api/auth/get-session", origin).toString(), {
        timeout: operationTimeout,
      });
    expect(session.status()).toBe(200);
    expect(
      Boolean(
        ((await session.json()) as { session?: unknown } | null)?.session,
      ),
    ).toBe(true);
  });
}

async function setupStaff(page: Page, fixture: MfaCsrfAppFixture) {
  return safe("staff-setup", async () => {
    await navigateToSetup(page, fixture.setupUrl);
    await page.getByLabel("Full name").fill("Disposable upload agent");
    await safe("staff-email", () =>
      page.getByLabel("Email").fill(fixture.email),
    );
    await safe("staff-password", () =>
      page.locator('input[name="password"]').fill(fixture.password),
    );
    const [signup] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
          response.request().method() === "POST",
        { timeout: operationTimeout },
      ),
      page.getByRole("button", { name: /^create account$/i }).click(),
    ]);
    expect(signup.status()).toBe(200);
    await completePendingFirstAdminInBrowser(page, fixture);
    const api = page.context().request;
    // D-A: only an instance administrator creates a workspace, and the request names its owner.
    // The signed-in user here is the bootstrap administrator, so they name themselves.
    const sessionResponse = await api.get(
      new URL("/api/auth/get-session", fixture.origin).toString(),
      { headers: { Origin: fixture.origin }, timeout: operationTimeout },
    );
    expect(sessionResponse.status()).toBe(200);
    const ownerUserId =
      (
        (await sessionResponse.json()) as {
          user?: { id?: string };
        } | null
      )?.user?.id ?? "";
    expect(ownerUserId).toBeTruthy();
    const workspace = await postWithCsrf(
      "agent",
      api,
      fixture.origin,
      "/api/workspace",
      { name: `Upload test ${randomUUID().slice(0, 8)}`, ownerUserId },
    );
    expect(workspace.status()).toBe(200);
    const { id: workspaceId } = (await workspace.json()) as { id: string };
    const project = await postWithCsrf(
      "agent",
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
        { headers: { Origin: fixture.origin }, timeout: operationTimeout },
      );
    expect(types.status()).toBe(200);
    const [{ id: workItemTypeId }] = (await types.json()) as [{ id: string }];
    return { workspaceId, projectId, workItemTypeId };
  });
}

async function patchWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  const csrf = await context.get(`${origin}/api/me/csrf-token`, {
    headers: { Origin: origin },
  });
  expect(csrf.status()).toBe(200);
  const { token } = await csrf.json();
  return context.patch(`${origin}${path}`, {
    data,
    headers: { Origin: origin, "x-taskdesk-csrf": token },
  });
}

async function observe(page: Page) {
  page.setDefaultTimeout(actionTimeout);
  page.setDefaultNavigationTimeout(operationTimeout);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push(`console: ${message.text().replace(/http[^\s]+/g, "[URL]")}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(
        `HTTP ${response.status()}: ${new URL(response.url()).pathname}`,
      );
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push(`${event.effectiveDirective}: ${event.blockedURI}`),
    );
  });
  return async () => {
    await expect(
      page.getByText("Something went wrong", { exact: true }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      ),
    ).toEqual([]);
  };
}

function assertEnforced(response: Response | null) {
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("script-src");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
}

async function exerciseAgentSignIn(page: Page, person: PortalPerson) {
  await page
    .getByRole("button", { name: "Use password instead", exact: true })
    .click();
  const email = page.getByLabel("Email", { exact: true });
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toBeVisible();
  let signIns = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/auth/sign-in/email" &&
      request.method() === "POST"
    )
      signIns++;
  });
  // Let the form resolver, rather than native email validation, reject invalid input.
  await email.evaluate((input) => {
    (input.closest("form") as HTMLFormElement).noValidate = true;
  });
  await email.fill("invalid");
  await safe("staff-password", () => password.fill(person.password));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  expect(signIns).toBe(0);
  await safe("staff-email", () => email.fill(person.email));
  // Wait out Better Auth's ten-second idle window without changing its limiter.
  await page.waitForTimeout(11_000);
  await safe("authenticated-api", async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
          response.request().method() === "POST",
      ),
      page.getByRole("button", { name: /^sign in$/i }).click(),
    ]);
    if (response.status() !== 200)
      throw new SafeFailure(
        `A87 enforced password sign-in HTTP ${response.status()}`,
      );
  });
  expect(signIns).toBe(1);
  await expect(page).toHaveURL(/\/(agent|dashboard)(\/|$)/);
}

async function openMenus(page: Page) {
  await page.getByRole("button", { name: "Filter queue", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Saved queue" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
}

test("A8-7 mobile triage cold loads and enforced CSP real-server matrix", async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(600_000);
  await withMfaCsrfApp(
    async (fixture) => {
      const browser = await chromium.launch({ headless: true });
      const staff = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const customer = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      try {
        const page = await staff.newPage();
        page.setDefaultTimeout(actionTimeout);
        const support = await setupStaff(page, fixture);
        const tenant = (await seedIntake(
          fixture,
          { phase: "workspace", ...support },
          "a87-tenant",
        )) as IntakeTenant;
        const typePath = `/api/request-types/${tenant.requestTypeId}`;
        expect(
          (
            await patchWithCsrf(staff.request, fixture.origin, typePath, {
              version: 1,
              customerVisible: true,
              defaultProjectId: null,
            })
          ).status(),
        ).toBe(200);
        expect(
          (
            await postWithCsrf(
              "agent",
              staff.request,
              fixture.origin,
              `${typePath}/publish`,
              {},
            )
          ).status(),
        ).toBe(200);
        const portal = fixture.origin.replace("localhost", "portal.localhost");
        const portalPage = await customer.newPage();
        await signIn(portalPage, portal, tenant.customer);
        const submission = await postWithCsrf(
          "customer",
          customer.request,
          portal,
          "/api/portal/submissions",
          {
            key: "access",
            formData: { summary: "Mobile triage persisted request" },
          },
        );
        expect(submission.status()).toBe(200);
        const { ref } = (await submission.json()) as { ref: string };
        const queueResponse = await postWithCsrf(
          "agent",
          staff.request,
          fixture.origin,
          "/api/intake/queues",
          {
            workspaceId: support.workspaceId,
            name: "Mobile saved queue",
            visibility: "private",
            submissionQuery: { entity: "submission", filter: { state: "new" } },
            workItemQuery: { entity: "work_item" },
          },
        );
        expect(queueResponse.status()).toBe(200);
        const { id: queueId } = (await queueResponse.json()) as { id: string };
        console.info("A87 persisted fixture ready");
        const staffState = await staff.storageState();
        for (const path of ["?state=new", `?queue=${queueId}`, `?ref=${ref}`]) {
          for (let load = 0; load < 10; load++) {
            const context = await browser.newContext({
              storageState: staffState,
              viewport: { width: 390, height: 844 },
            });
            try {
              const current = await context.newPage();
              const clean = await observe(current);
              await current.goto(`${fixture.origin}/agent/triage${path}`);
              await expect(current.getByTestId("triage-content")).toBeVisible();
              if (path.includes("queue="))
                await expect(
                  current.getByRole("button", { name: "Saved queue" }),
                ).toHaveText("Mobile saved queue");
              await expect(
                current
                  .getByText("Mobile triage persisted request", { exact: true })
                  .first(),
              ).toBeVisible();
              if (path.includes("ref=")) {
                await expect(current.getByRole("dialog")).toBeVisible();
                await expect(
                  current
                    .getByTestId("submission-detail-sheet")
                    .getByText("Submitted answers", { exact: true }),
                ).toBeVisible();
                await current.keyboard.press("Escape");
                await expect(current.getByRole("dialog")).toHaveCount(0);
              }
              await openMenus(current);
              await clean();
              if (load === 0)
                await current.screenshot({
                  animations: "disabled",
                  path: info.outputPath(
                    `triage-${path.includes("queue") ? "saved" : path.includes("ref") ? "detail" : "new"}-390.png`,
                  ),
                });
            } finally {
              await context.close();
            }
          }
        }
        console.info("A87 administrator cold loads complete");
        const people = (await seedIntake(
          fixture,
          { phase: "staff", workspaceId: support.workspaceId },
          "a87-staff",
        )) as { member: PortalPerson; lead: PortalPerson; admin: PortalPerson };
        for (const role of ["member", "lead", "admin"] as const) {
          const login = await browser.newContext({
            viewport: { width: 390, height: 844 },
          });
          try {
            await safe("authenticated-api", async () => {
              const response = await login.request.post(
                `${fixture.origin}/api/auth/sign-in/email`,
                {
                  headers: { Origin: fixture.origin },
                  data: {
                    email: people[role].email,
                    password: people[role].password,
                  },
                },
              );
              expect(response.status()).toBe(200);
            });
            expect(
              (
                await postWithCsrf(
                  "agent",
                  login.request,
                  fixture.origin,
                  `/api/workspace/${support.workspaceId}/activate`,
                  {},
                )
              ).status(),
            ).toBe(200);
            let roleQueue = "";
            if (role !== "member") {
              const result = await postWithCsrf(
                "agent",
                login.request,
                fixture.origin,
                "/api/intake/queues",
                {
                  workspaceId: support.workspaceId,
                  name: `${role} saved queue`,
                  visibility: "private",
                  submissionQuery: {
                    entity: "submission",
                    filter: { state: "new" },
                  },
                  workItemQuery: { entity: "work_item" },
                },
              );
              expect(result.status()).toBe(200);
              roleQueue = (await result.json()).id;
            }
            const state = await login.storageState();
            for (const suffix of role === "member"
              ? ["", "?state=new"]
              : ["?state=new", `?queue=${roleQueue}`, `?ref=${ref}`]) {
              for (let load = 0; load < 10; load++) {
                const context = await browser.newContext({
                  storageState: state,
                  viewport: { width: 390, height: 844 },
                });
                try {
                  const current = await context.newPage();
                  const clean = await observe(current);
                  const intakeCalls: string[] = [];
                  current.on("request", (request) => {
                    if (
                      /\/api\/(submissions|intake|request-types)/.test(
                        new URL(request.url()).pathname,
                      )
                    )
                      intakeCalls.push(new URL(request.url()).pathname);
                  });
                  await current.goto(`${fixture.origin}/agent/triage${suffix}`);
                  if (role === "member") {
                    await expect(
                      current.getByTestId("settings-access-denied"),
                    ).toBeVisible();
                    expect(intakeCalls).toEqual([]);
                  } else {
                    await expect(
                      current
                        .getByText("Mobile triage persisted request", {
                          exact: true,
                        })
                        .first(),
                    ).toBeVisible();
                    if (suffix.includes("queue="))
                      await expect(
                        current.getByRole("button", { name: "Saved queue" }),
                      ).toHaveText(`${role} saved queue`);
                    if (suffix.includes("ref=")) {
                      await expect(current.getByRole("dialog")).toBeVisible();
                      await expect(
                        current
                          .getByTestId("submission-detail-sheet")
                          .getByText("Submitted answers", { exact: true }),
                      ).toBeVisible();
                      await current.keyboard.press("Escape");
                      await expect(current.getByRole("dialog")).toHaveCount(0);
                    }
                    await openMenus(current);
                  }
                  await clean();
                } finally {
                  await context.close();
                }
              }
            }
          } finally {
            await login.close();
          }
        }
        for (let load = 0; load < 10; load++) {
          const context = await browser.newContext({
            storageState: await customer.storageState(),
            viewport: { width: 390, height: 844 },
          });
          try {
            const current = await context.newPage();
            const clean = await observe(current);
            await current.goto(`${fixture.origin}/agent/triage`);
            await expect(current).toHaveURL(/\/auth\/sign-in/);
            await expect(current.getByLabel("Email")).toBeVisible();
            await clean();
          } finally {
            await context.close();
          }
        }
        console.info("A87 role cold loads complete");
        const settings = await staff.request.get(
          `${fixture.origin}/api/instance/settings`,
        );
        expect(settings.status()).toBe(200);
        expect(
          (
            await patchWithCsrf(
              staff.request,
              fixture.origin,
              "/api/instance/settings",
              {
                expectedUpdatedAt: (await settings.json()).updatedAt,
                changes: { cspMode: "enforce" },
              },
            )
          ).status(),
        ).toBe(200);
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 390, height: 844 },
        ]) {
          for (const theme of ["light", "dark"] as const) {
            for (const redirect of [false, true]) {
              const context = await browser.newContext({
                viewport,
                colorScheme: theme,
                ...(redirect
                  ? { storageState: await customer.storageState() }
                  : {}),
              });
              try {
                await context.addInitScript(
                  (theme) =>
                    localStorage.setItem(
                      "user-preferences",
                      JSON.stringify({ state: { theme }, version: 0 }),
                    ),
                  theme,
                );
                const current = await context.newPage();
                const clean = await observe(current);
                assertEnforced(
                  await current.goto(
                    `${fixture.origin}${redirect ? "/agent/triage" : "/auth/sign-in"}`,
                  ),
                );
                await expect(current).toHaveURL(/\/auth\/sign-in/);
                await expect(current.locator("html")).toHaveClass(
                  new RegExp(`\\b${theme}\\b`),
                );
                await exerciseAgentSignIn(current, people.member);
                await clean();
              } finally {
                await context.close();
              }
            }
            const context = await browser.newContext({
              viewport,
              colorScheme: theme,
            });
            try {
              await context.addInitScript(
                (theme) =>
                  localStorage.setItem(
                    "user-preferences",
                    JSON.stringify({ state: { theme }, version: 0 }),
                  ),
                theme,
              );
              const current = await context.newPage();
              const clean = await observe(current);
              assertEnforced(await current.goto(`${portal}/sign-in`));
              await expect(current.locator("html")).toHaveClass(
                new RegExp(`\\b${theme}\\b`),
              );
              const email = current.getByLabel("Email", { exact: true });
              await email.fill("invalid");
              await current.getByRole("button", { name: /^sign in$/i }).click();
              expect(
                await email.evaluate(
                  (input) => (input as HTMLInputElement).validity.valid,
                ),
              ).toBe(false);
              await clean();
              await current.waitForTimeout(11_000);
              await signIn(current, portal, tenant.customer);
              await expect(current).toHaveURL(
                new RegExp(`^${portal}/(?:\\?.*)?$`),
              );
              await clean();
            } finally {
              await context.close();
            }
          }
        }
        console.info("A87 enforced sign-in resolver checks complete");
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 390, height: 844 },
        ]) {
          for (const theme of ["light", "dark"] as const) {
            for (const [origin, state, paths] of [
              [
                fixture.origin,
                staffState,
                [
                  "/agent/triage?state=new",
                  "/agent",
                  "/god-mode/authentication",
                ],
              ],
              [portal, await customer.storageState(), ["/", "/requests"]],
            ] as const) {
              const context = await browser.newContext({
                storageState: state,
                viewport,
                colorScheme: theme,
              });
              try {
                await context.addInitScript(
                  (theme) =>
                    localStorage.setItem(
                      "user-preferences",
                      JSON.stringify({ state: { theme }, version: 0 }),
                    ),
                  theme,
                );
                const current = await context.newPage();
                const clean = await observe(current);
                for (const path of paths) {
                  const response = await current.goto(`${origin}${path}`);
                  expect(response?.status()).toBe(200);
                  const headers = response?.headers() ?? {};
                  expect(headers["content-security-policy"]).toContain(
                    "script-src",
                  );
                  expect(
                    headers["content-security-policy-report-only"],
                  ).toBeUndefined();
                  await expect(current.locator("h1").first()).toBeVisible();
                  await expect(current.locator("html")).toHaveClass(
                    new RegExp(`\\b${theme}\\b`),
                  );
                  if (origin === portal && path === "/requests") {
                    await current
                      .getByRole("button", { name: "Status", exact: true })
                      .click();
                    await expect(current.getByRole("menu")).toBeVisible();
                    await current.keyboard.press("Escape");
                  }
                  if (path.includes("triage")) {
                    await expect(
                      current
                        .getByText("Mobile triage persisted request", {
                          exact: true,
                        })
                        .first(),
                    ).toBeVisible();
                    await openMenus(current);
                    await current
                      .locator(`[data-submission-ref="${ref}"]`)
                      .click();
                    await expect(current.getByRole("dialog")).toBeVisible();
                    await expect(
                      current
                        .getByTestId("submission-detail-sheet")
                        .getByText("Submitted answers", { exact: true }),
                    ).toBeVisible();
                    await current.screenshot({
                      animations: "disabled",
                      path: info.outputPath(
                        `csp-sheet-${viewport.width}-${theme}.png`,
                      ),
                    });
                    await current.keyboard.press("Escape");
                    await expect(current.getByRole("dialog")).toHaveCount(0);
                  }
                  await clean();
                  await current.screenshot({
                    animations: "disabled",
                    path: info.outputPath(
                      `csp-${origin === portal ? "portal" : "agent"}-${path.replace(/[^a-z]/g, "_")}-${viewport.width}-${theme}.png`,
                    ),
                  });
                }
              } finally {
                await context.close();
              }
            }
          }
        }
        await seedIntake(
          fixture,
          { phase: "off", workspaceId: support.workspaceId },
          "a87-off",
        );
        const off = await browser.newContext({
          storageState: staffState,
          viewport: { width: 390, height: 844 },
        });
        try {
          const current = await off.newPage();
          const clean = await observe(current);
          const calls: string[] = [];
          current.on("request", (request) => {
            if (
              /\/api\/(submissions|intake|request-types)/.test(
                new URL(request.url()).pathname,
              )
            )
              calls.push(new URL(request.url()).pathname);
          });
          await current.goto(`${fixture.origin}/agent/triage?state=new`);
          await expect(current.getByTestId("feature-off-intake")).toBeVisible();
          expect(calls).toEqual([]);
          await clean();
        } finally {
          await off.close();
        }
      } finally {
        await staff.close();
        await customer.close();
        await browser.close();
      }
    },
    {
      ...fixtureOwnershipJournal(info.outputPath("fixture-ownership.jsonl")),
      enableEmailCodeSignIn: true,
      beforeStart: async (fixture) => {
        await runPrivate(
          fixture,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "a87-auth",
        );
        await seedIntake(fixture, { phase: "instance" }, "a87-instance");
        await seedIntake(fixture, { phase: "auth-ui" }, "a87-auth-ui");
        const input = resolve(fixture.fixtureDir, "portal-input.json");
        const output = resolve(fixture.fixtureDir, "portal-output.json");
        writeFileSync(input, JSON.stringify({ phase: "instance" }), {
          mode: 0o600,
        });
        await runPrivate(
          fixture,
          [
            "--tsconfig",
            resolve(repoRoot, "apps/api/tsconfig.tests.json"),
            resolve(repoRoot, "tests/e2e/scripts/seed-portal-projects.ts"),
            input,
            output,
          ],
          "a87-portal",
        );
      },
    },
  );
});
