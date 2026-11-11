import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  fixtureOwnershipJournal,
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";

/** Source-runtime evidence only: fresh PostgreSQL, private filesystem and real portal sessions. */
const repoRoot = resolve(import.meta.dirname, "../..");
const requireWeb = createRequire(resolve(repoRoot, "apps/web/package.json"));
const { chromium, expect, test } = requireWeb(
  "@playwright/test",
) as typeof import("@playwright/test");
const bytes = Buffer.from("Disposable browser evidence.\n");
const fileName = "browser-evidence.txt";
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
    throw new SafeFailure(`A84 ${phase} failed.`);
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
      throw new Error("A84 request origin must be canonical.");
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
    await page.goto(new URL("/auth/sign-up", fixture.origin).toString());
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
    const workspace = await postWithCsrf(
      "agent",
      page.context().request,
      fixture.origin,
      "/api/workspace",
      { name: `Upload test ${randomUUID().slice(0, 8)}` },
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

const fields = [
  {
    key: "summary",
    type: "text",
    label: "Summary",
    required: true,
    mapsTo: { field: "title" },
  },
  { key: "gate", type: "checkbox", label: "Include details" },
  {
    key: "details",
    type: "text",
    label: "Conditional details",
    showIf: { field_key: "gate", op: "eq", value: true },
  },
  {
    key: "evidence",
    type: "file",
    label: "Conditional evidence",
    showIf: { field_key: "gate", op: "eq", value: true },
  },
  { key: "quantity", type: "number", label: "Quantity" },
];

async function patchWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  return safe("authenticated-api", async () => {
    const csrf = await context.get(
      new URL("/api/me/csrf-token", origin).toString(),
      { headers: { Origin: origin }, timeout: operationTimeout },
    );
    expect(csrf.status()).toBe(200);
    const { token } = (await csrf.json()) as { token: string };
    return context.patch(new URL(path, origin).toString(), {
      data,
      headers: { Origin: origin, "x-taskdesk-csrf": token },
      timeout: operationTimeout,
    });
  });
}

// Modify only the freshly published version in the disposable fixture, to emulate
// the historic string-boolean representation that the current editor normalizes.
async function makePublishedConditionLegacy(
  fixture: MfaCsrfAppFixture,
  requestTypeId: string,
) {
  const requireApi = createRequire(resolve(repoRoot, "apps/api/package.json"));
  const { Client } = requireApi("pg") as typeof import("pg");
  const client = new Client({
    connectionString: fixture.databaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  await client.connect();
  try {
    const legacy = {
      fields: fields.map((field) =>
        "showIf" in field
          ? { ...field, showIf: { ...field.showIf, value: "true" } }
          : field,
      ),
    };
    const result = await client.query(
      "UPDATE request_type_version SET form_schema = $1::jsonb WHERE request_type_id = $2 AND number = (SELECT max(number) FROM request_type_version WHERE request_type_id = $2)",
      [JSON.stringify(legacy), requestTypeId],
    );
    expect(result.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

test("request form conditions, numbers and files persist in an isolated portal", async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(600_000);
  if (
    info.config.reporter.length !== 1 ||
    info.config.reporter[0]?.[0] !== "list" ||
    (["trace", "video", "screenshot"] as const).some((key) => {
      const value = info.project.use[key];
      return value !== undefined && value !== "off";
    })
  ) {
    throw new Error("A84 requires the list reporter and capture disabled.");
  }
  const journalPath = info.outputPath("a84-phases.jsonl");
  closeSync(openSync(journalPath, "wx", 0o600));
  const startedAt = performance.now();
  type Phase =
    | "fixture"
    | "seed-auth"
    | "seed-instance"
    | "seed-portal"
    | "browser-setup"
    | "staff-setup"
    | "seed-workspace"
    | "editor-api"
    | "editor-navigation"
    | "editor-mapping"
    | "mapping-open-description"
    | "mapping-select-description"
    | "mapping-close-description"
    | "mapping-hide-description-list"
    | "mapping-open-clear"
    | "mapping-clear-option-visible"
    | "mapping-select-clear"
    | "mapping-clear-committed"
    | "editor-condition"
    | "editor-save-click"
    | "editor-save-response"
    | "editor-readback"
    | "editor-reload"
    | "editor-api-readback"
    | "editor-show-when-label"
    | "editor-mapping-label"
    | "locale"
    | "legacy-db"
    | "portal-sign-in"
    | "hidden-submission"
    | "crafted-submission"
    | "visible-submission"
    | "browser-cleanup";
  let journalFailed = false;
  const mark = (phase: Phase, state: "start" | "complete") => {
    try {
      appendFileSync(
        journalPath,
        `${JSON.stringify({ phase, state, elapsedMs: Math.floor(performance.now() - startedAt) })}\n`,
        { mode: 0o600 },
      );
    } catch {
      journalFailed = true;
    }
  };
  mark("fixture", "start");
  await withMfaCsrfApp(
    async (fixture) =>
      safe("browser-journey", async () => {
        mark("browser-setup", "start");
        const portal = new URL(fixture.origin);
        portal.hostname = `portal.${portal.hostname}`;
        const browser = await chromium.launch({ headless: true });
        const staff = await browser.newContext();
        const customer = await browser.newContext();
        for (const context of [staff, customer]) {
          context.setDefaultTimeout(actionTimeout);
          context.setDefaultNavigationTimeout(operationTimeout);
        }
        try {
          const staffPage = await staff.newPage();
          mark("browser-setup", "complete");
          mark("staff-setup", "start");
          const support = await setupStaff(staffPage, fixture);
          mark("staff-setup", "complete");
          mark("seed-workspace", "start");
          const tenant = (await seedIntake(
            fixture,
            { phase: "workspace", ...support },
            "a84-tenant",
          )) as IntakeTenant;
          mark("seed-workspace", "complete");
          mark("editor-api", "start");
          const path = `/api/request-types/${encodeURIComponent(tenant.requestTypeId)}`;
          const patch = await patchWithCsrf(
            staff.request,
            fixture.origin,
            path,
            {
              version: 1,
              customerVisible: true,
              formSchema: { fields },
            },
          );
          expect(patch.status()).toBe(200);
          const published = await postWithCsrf(
            "agent",
            staff.request,
            fixture.origin,
            `${path}/publish`,
            {},
          );
          expect(published.status()).toBe(200);
          mark("editor-api", "complete");
          mark("editor-navigation", "start");
          await staffPage.goto(
            new URL(
              `/dashboard/settings/workspace/request-types?requestTypeId=${encodeURIComponent(tenant.requestTypeId)}`,
              fixture.origin,
            ).toString(),
          );
          await expect(staffPage.locator("#field-show-when-2")).toContainText(
            "Include details",
          );
          mark("editor-navigation", "complete");
          mark("editor-mapping", "start");
          const mappingTrigger = staffPage.locator("#field-maps-to-2");
          mark("mapping-open-description", "start");
          await mappingTrigger.click();
          await expect(mappingTrigger).toHaveAttribute(
            "aria-expanded",
            "true",
            {
              timeout: actionTimeout,
            },
          );
          await expect(mappingTrigger).toHaveAttribute("aria-controls", /.+/, {
            timeout: actionTimeout,
          });
          const descriptionListId =
            await mappingTrigger.getAttribute("aria-controls");
          if (!descriptionListId)
            throw new Error("A84 mapping list unavailable.");
          const descriptionList = staffPage.locator(
            `[id=${JSON.stringify(descriptionListId)}]`,
          );
          mark("mapping-open-description", "complete");
          mark("mapping-select-description", "start");
          await descriptionList
            .getByRole("option", { name: "Work item description", exact: true })
            .click();
          mark("mapping-select-description", "complete");
          mark("mapping-close-description", "start");
          await expect(mappingTrigger).toContainText("Work item description", {
            timeout: actionTimeout,
          });
          await expect(mappingTrigger).toHaveAttribute(
            "aria-expanded",
            "false",
            {
              timeout: actionTimeout,
            },
          );
          mark("mapping-close-description", "complete");
          mark("mapping-hide-description-list", "start");
          await expect(descriptionList).toBeHidden({ timeout: actionTimeout });
          mark("mapping-hide-description-list", "complete");
          mark("mapping-open-clear", "start");
          await mappingTrigger.click();
          await expect(mappingTrigger).toHaveAttribute(
            "aria-expanded",
            "true",
            {
              timeout: actionTimeout,
            },
          );
          await expect(mappingTrigger).toHaveAttribute("aria-controls", /.+/, {
            timeout: actionTimeout,
          });
          const clearListId =
            await mappingTrigger.getAttribute("aria-controls");
          if (!clearListId) throw new Error("A84 mapping list unavailable.");
          const clearOption = staffPage
            .locator(`[id=${JSON.stringify(clearListId)}]`)
            .getByRole("option", { name: "Keep in Request data", exact: true });
          const sampleClearMenu = async (
            state: "after-open" | "visibility-failure",
          ) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const sample = await Promise.race([
                (async () => {
                  const dom = await staffPage.evaluate((expectedListId) => {
                    const trigger = document.querySelector("#field-maps-to-2");
                    const controlledId = trigger?.getAttribute("aria-controls");
                    const controlled = controlledId
                      ? Array.from(document.querySelectorAll("[id]")).filter(
                          (element) => element.id === controlledId,
                        )
                      : [];
                    const list = controlled.length === 1 ? controlled[0] : null;
                    const positioner = list?.closest(
                      '[data-slot="select-positioner"]',
                    );
                    const visible = (element: Element | null | undefined) => {
                      if (!element) return false;
                      const style = getComputedStyle(element);
                      const rect = element.getBoundingClientRect();
                      return (
                        style.visibility === "visible" &&
                        style.display !== "none" &&
                        rect.width > 0 &&
                        rect.height > 0
                      );
                    };
                    const clearItems = list
                      ? Array.from(
                          list.querySelectorAll('[data-slot="select-item"]'),
                        ).filter(
                          (element) =>
                            element.textContent?.trim() ===
                            "Keep in Request data",
                        )
                      : [];
                    return {
                      triggerExpanded:
                        trigger?.getAttribute("aria-expanded") === "true",
                      controlsMatchesListId: controlledId === expectedListId,
                      controlledIdCount: controlled.length,
                      controlledRoleIsListbox:
                        list?.getAttribute("role") === "listbox",
                      controlledVisible: visible(list),
                      positionerHidden: !visible(positioner),
                      positionerInert: Boolean(positioner?.closest("[inert]")),
                      clearTextDomCount: clearItems.length,
                      clearDisabled:
                        clearItems.length === 1
                          ? clearItems[0]?.hasAttribute("disabled") ||
                            clearItems[0]?.getAttribute("aria-disabled") ===
                              "true" ||
                            clearItems[0]?.hasAttribute("data-disabled")
                          : null,
                    };
                  }, clearListId);
                  const list = staffPage.locator(
                    `[id=${JSON.stringify(clearListId)}]`,
                  );
                  const clearRoleIncludingHiddenCount = await list
                    .getByRole("option", {
                      name: "Keep in Request data",
                      exact: true,
                      includeHidden: true,
                    })
                    .count();
                  const clearVisibleRoleCount = await list
                    .getByRole("option", {
                      name: "Keep in Request data",
                      exact: true,
                    })
                    .filter({ visible: true })
                    .count();
                  return {
                    ...dom,
                    clearRoleIncludingHiddenCount,
                    clearVisibleRoleCount,
                  };
                })(),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () => reject(new Error("A84 menu sample timed out.")),
                    3_000,
                  );
                }),
              ]);
              const {
                triggerExpanded,
                controlsMatchesListId,
                controlledIdCount,
                controlledRoleIsListbox,
                controlledVisible,
                positionerHidden,
                positionerInert,
                clearTextDomCount,
                clearRoleIncludingHiddenCount,
                clearVisibleRoleCount,
                clearDisabled,
              } = sample;
              if (
                ![
                  triggerExpanded,
                  controlsMatchesListId,
                  controlledRoleIsListbox,
                  controlledVisible,
                  positionerHidden,
                  positionerInert,
                ].every((value) => typeof value === "boolean") ||
                ![
                  controlledIdCount,
                  clearTextDomCount,
                  clearRoleIncludingHiddenCount,
                  clearVisibleRoleCount,
                ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
                !(clearDisabled === null || typeof clearDisabled === "boolean")
              )
                throw new Error("A84 menu sample invalid.");
              appendFileSync(
                journalPath,
                `${JSON.stringify({
                  phase: "mapping-menu-sample",
                  state,
                  triggerExpanded,
                  controlsMatchesListId,
                  controlledIdCount,
                  controlledRoleIsListbox,
                  controlledVisible,
                  positionerHidden,
                  positionerInert,
                  clearTextDomCount,
                  clearRoleIncludingHiddenCount,
                  clearVisibleRoleCount,
                  clearDisabled,
                })}\n`,
                { mode: 0o600 },
              );
            } catch {
              journalFailed = true;
            } finally {
              if (timer) clearTimeout(timer);
            }
          };
          mark("mapping-open-clear", "complete");
          await sampleClearMenu("after-open");
          mark("mapping-clear-option-visible", "start");
          try {
            await expect(clearOption).toBeVisible({ timeout: actionTimeout });
          } catch (error) {
            await sampleClearMenu("visibility-failure");
            throw error;
          }
          mark("mapping-clear-option-visible", "complete");
          mark("mapping-select-clear", "start");
          await clearOption.click();
          mark("mapping-select-clear", "complete");
          mark("mapping-clear-committed", "start");
          await expect(mappingTrigger).toContainText("Keep in Request data", {
            timeout: actionTimeout,
          });
          await expect(mappingTrigger).toHaveAttribute(
            "aria-expanded",
            "false",
            {
              timeout: actionTimeout,
            },
          );
          mark("mapping-clear-committed", "complete");
          mark("editor-mapping", "complete");
          mark("editor-condition", "start");
          await staffPage.locator("#field-show-when-2").click();
          await staffPage
            .getByRole("option", { name: "Always visible", exact: true })
            .click();
          mark("editor-condition", "complete");
          mark("editor-save-click", "start");
          mark("editor-save-response", "start");
          const [saved] = await Promise.all([
            staffPage
              .waitForResponse(
                (result) =>
                  new URL(result.url()).pathname === path &&
                  result.request().method() === "PATCH",
                { timeout: operationTimeout },
              )
              .then((response) => {
                mark("editor-save-response", "complete");
                return response;
              }),
            staffPage
              .getByRole("button", { name: "Save draft", exact: true })
              .click()
              .then(() => mark("editor-save-click", "complete")),
          ]);
          expect(saved.status()).toBe(200);
          mark("editor-readback", "start");
          mark("editor-reload", "start");
          await staffPage.reload();
          mark("editor-reload", "complete");
          mark("editor-api-readback", "start");
          const draft = await staff.request.get(
            new URL(path, fixture.origin).toString(),
            { timeout: operationTimeout },
          );
          expect(draft.status()).toBe(200);
          const draftData = (await draft.json()) as {
            formSchema: { fields: Array<Record<string, unknown>> };
          };
          expect(draftData.formSchema.fields[2]).not.toHaveProperty("showIf");
          expect(draftData.formSchema.fields[2]).not.toHaveProperty("mapsTo");
          mark("editor-api-readback", "complete");
          mark("editor-show-when-label", "start");
          await expect(staffPage.locator("#field-show-when-2")).toContainText(
            "Always visible",
          );
          mark("editor-show-when-label", "complete");
          mark("editor-mapping-label", "start");
          await expect(staffPage.locator("#field-maps-to-2")).toContainText(
            "Keep in Request data",
          );
          mark("editor-mapping-label", "complete");
          // These catalog entries currently contain English text in every locale.
          // Confirm the clear controls still load from the supported French locale.
          mark("editor-readback", "complete");
          mark("locale", "start");
          const french = await browser.newContext({
            locale: "fr-FR",
            storageState: await staff.storageState(),
          });
          french.setDefaultTimeout(actionTimeout);
          french.setDefaultNavigationTimeout(operationTimeout);
          try {
            const frenchPage = await french.newPage();
            await frenchPage.goto(
              new URL(
                `/dashboard/settings/workspace/request-types?requestTypeId=${encodeURIComponent(tenant.requestTypeId)}`,
                fixture.origin,
              ).toString(),
            );
            await expect(frenchPage.locator("html")).toHaveAttribute(
              "lang",
              "fr-FR",
            );
            await expect(
              frenchPage.locator("#field-show-when-2"),
            ).toContainText("Always visible");
            await expect(frenchPage.locator("#field-maps-to-2")).toContainText(
              "Keep in Request data",
            );
            await frenchPage.locator("#field-show-when-2").click();
            await expect(
              frenchPage.getByRole("option", {
                name: "Always visible",
                exact: true,
              }),
            ).toBeVisible();
            await frenchPage.keyboard.press("Escape");
            await frenchPage.locator("#field-maps-to-2").click();
            await expect(
              frenchPage.getByRole("option", {
                name: "Keep in Request data",
                exact: true,
              }),
            ).toBeVisible();
          } finally {
            await french.close();
          }
          mark("locale", "complete");
          mark("legacy-db", "start");
          await makePublishedConditionLegacy(fixture, tenant.requestTypeId);
          mark("legacy-db", "complete");
          mark("portal-sign-in", "start");

          const page = await customer.newPage();
          await signIn(page, portal.toString(), tenant.customer);
          mark("portal-sign-in", "complete");
          mark("hidden-submission", "start");
          await page.goto(new URL("/catalogue?key=access", portal).toString());
          const gate = page.getByRole("checkbox", { name: "Include details" });
          const details = page.getByLabel("Conditional details");
          const file = page.locator("#request-field-evidence");
          await expect(details).toHaveCount(0);
          await gate.check();
          await expect(details).toBeVisible();
          await details.fill("Hidden after changing the checkbox");
          await file.setInputFiles({
            name: fileName,
            mimeType: "text/plain",
            buffer: bytes,
          });
          await gate.uncheck();
          await expect(details).toHaveCount(0);
          await expect(file).toHaveCount(0);
          await page.getByLabel("Summary").fill("Hidden fields request");
          await page.getByLabel("Quantity").fill("42.5");
          let presigns = 0;
          page.on("request", (request) => {
            if (
              request.method() === "POST" &&
              new URL(request.url()).pathname.endsWith("/attachments/presign")
            )
              presigns++;
          });
          const [response] = await Promise.all([
            page.waitForResponse(
              (response) =>
                new URL(response.url()).pathname ===
                  "/api/portal/submissions" &&
                response.request().method() === "POST",
              { timeout: operationTimeout },
            ),
            page.getByRole("button", { name: /^submit request$/i }).click(),
          ]);
          expect(response.status()).toBe(200);
          const body = response.request().postDataJSON() as {
            formData: Record<string, unknown>;
          };
          expect(body.formData.quantity).toBe(42.5);
          expect(body.formData).not.toHaveProperty("details");
          expect(body.formData).not.toHaveProperty("evidence");
          const { ref } = (await response.json()) as { ref: string };
          await expect(page).toHaveURL(new RegExp(`/submissions/${ref}$`, "u"));
          expect(presigns).toBe(0);
          const hiddenAttachments = await customer.request.get(
            new URL(
              `/api/portal/submissions/${ref}/attachments`,
              portal,
            ).toString(),
            { timeout: operationTimeout },
          );
          expect(hiddenAttachments.status()).toBe(200);
          const hiddenRows = (await hiddenAttachments.json()) as Array<{
            filename: string;
          }>;
          expect(hiddenRows.some((row) => row.filename === fileName)).toBe(
            false,
          );
          await page.reload();
          const persisted = await customer.request.get(
            new URL(`/api/portal/submissions/${ref}`, portal).toString(),
            { timeout: operationTimeout },
          );
          expect(persisted.status()).toBe(200);
          const data = (await persisted.json()) as {
            submission: { formData: Record<string, unknown> };
          };
          expect(data.submission.formData.quantity).toBe(42.5);
          expect(data.submission.formData).not.toHaveProperty("details");
          expect(data.submission.formData).not.toHaveProperty("evidence");

          mark("hidden-submission", "complete");
          mark("crafted-submission", "start");
          const crafted = await postWithCsrf(
            "customer",
            customer.request,
            portal.origin,
            "/api/portal/submissions",
            {
              key: "access",
              formData: {
                summary: "Crafted hidden answer",
                gate: false,
                details: "must be stripped",
                quantity: 7,
              },
            },
          );
          expect(crafted.status()).toBe(200);
          const craftedRef = ((await crafted.json()) as { ref: string }).ref;
          const readback = await customer.request.get(
            new URL(`/api/portal/submissions/${craftedRef}`, portal).toString(),
            { timeout: operationTimeout },
          );
          expect(readback.status()).toBe(200);
          const craftedData = (await readback.json()) as {
            submission: { formData: Record<string, unknown> };
          };
          expect(craftedData.submission.formData).not.toHaveProperty("details");
          expect(craftedData.submission.formData.quantity).toBe(7);

          mark("crafted-submission", "complete");
          mark("visible-submission", "start");
          await page.goto(new URL("/catalogue?key=access", portal).toString());
          await page.getByLabel("Summary").fill("Visible file request");
          await page.getByRole("checkbox", { name: "Include details" }).check();
          await page.getByLabel("Conditional details").fill("Visible answer");
          await page.locator("#request-field-evidence").setInputFiles({
            name: fileName,
            mimeType: "text/plain",
            buffer: bytes,
          });
          const [visibleResponse] = await Promise.all([
            page.waitForResponse(
              (result) =>
                new URL(result.url()).pathname === "/api/portal/submissions" &&
                result.request().method() === "POST",
              { timeout: operationTimeout },
            ),
            page.getByRole("button", { name: /^submit request$/i }).click(),
          ]);
          expect(visibleResponse.status()).toBe(200);
          const visibleRef = ((await visibleResponse.json()) as { ref: string })
            .ref;
          await expect(page).toHaveURL(
            new RegExp(`/submissions/${visibleRef}$`, "u"),
          );
          expect(presigns).toBe(1);
          await page.reload();
          await expect(
            page.getByText(fileName, { exact: true }).first(),
          ).toBeVisible();
          const attachments = await customer.request.get(
            new URL(
              `/api/portal/submissions/${visibleRef}/attachments`,
              portal,
            ).toString(),
            { timeout: operationTimeout },
          );
          expect(attachments.status()).toBe(200);
          expect((await attachments.json()) as unknown[]).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ filename: fileName, state: "ready" }),
            ]),
          );
          mark("visible-submission", "complete");
        } finally {
          mark("browser-cleanup", "start");
          const cleanup = await Promise.allSettled([
            staff.close(),
            customer.close(),
          ]);
          await browser.close();
          mark("browser-cleanup", "complete");
          expect(cleanup.map((result) => result.status)).toEqual([
            "fulfilled",
            "fulfilled",
          ]);
        }
      }),
    {
      discardChildOutput: true,
      ...fixtureOwnershipJournal(info.outputPath("fixture-ownership.jsonl")),
      beforeStart: async (fixture) => {
        mark("seed-auth", "start");
        await runPrivate(
          fixture,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "a84-auth-provider",
        );
        mark("seed-auth", "complete");
        mark("seed-instance", "start");
        await seedIntake(fixture, { phase: "instance" }, "a84-instance");
        mark("seed-instance", "complete");
        mark("seed-portal", "start");
        await seedIntakePortal(fixture);
        mark("seed-portal", "complete");
      },
    },
  ).catch((error: unknown) => {
    if (!journalFailed && error instanceof SafeFailure) throw error;
    throw new Error(
      journalFailed
        ? "A84 fixture failed; phase journal was incomplete."
        : "A84 fixture failed; see the phase journal.",
    );
  });
  mark("fixture", "complete");
  if (journalFailed) throw new Error("A84 phase journal write failed.");
});

async function seedIntakePortal(fixture: Fixture) {
  const inputPath = resolve(fixture.fixtureDir, "a84-portal-input.json");
  const outputPath = resolve(fixture.fixtureDir, "a84-portal-output.json");
  writeFileSync(inputPath, JSON.stringify({ phase: "instance" }), {
    mode: 0o600,
  });
  await runPrivate(
    fixture,
    [
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, "tests/e2e/scripts/seed-portal-projects.ts"),
      inputPath,
      outputPath,
    ],
    "a84-portal",
  );
  expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual({
    feature: "feature.customer_portal",
  });
}
