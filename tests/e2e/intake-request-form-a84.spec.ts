import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
  const workspace = await postWithCsrf(
    page.context().request,
    fixture.origin,
    "/api/workspace",
    { name: `Upload test ${randomUUID().slice(0, 8)}` },
  );
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
  const csrf = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(csrf.status()).toBe(200);
  const { token } = (await csrf.json()) as { token: string };
  return context.patch(new URL(path, origin).toString(), {
    data,
    headers: { Origin: origin, "x-taskdesk-csrf": token },
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
  await withMfaCsrfApp(
    async (fixture) => {
      const portal = new URL(fixture.origin);
      portal.hostname = `portal.${portal.hostname}`;
      const browser = await chromium.launch({ headless: true });
      const staff = await browser.newContext();
      const customer = await browser.newContext();
      try {
        const staffPage = await staff.newPage();
        const support = await setupStaff(staffPage, fixture);
        const tenant = (await seedIntake(
          fixture,
          { phase: "workspace", ...support },
          "a84-tenant",
        )) as IntakeTenant;
        const path = `/api/request-types/${encodeURIComponent(tenant.requestTypeId)}`;
        const patch = await patchWithCsrf(staff.request, fixture.origin, path, {
          version: 1,
          customerVisible: true,
          formSchema: { fields },
        });
        expect(patch.status()).toBe(200);
        const published = await postWithCsrf(
          staff.request,
          fixture.origin,
          `${path}/publish`,
          {},
        );
        expect(published.status()).toBe(200);
        await staffPage.goto(
          new URL(
            `/dashboard/settings/workspace/request-types?requestTypeId=${encodeURIComponent(tenant.requestTypeId)}`,
            fixture.origin,
          ).toString(),
        );
        await expect(staffPage.locator("#field-show-when-2")).toContainText(
          "Include details",
        );
        await staffPage.locator("#field-maps-to-2").click();
        await staffPage
          .getByRole("option", { name: "Work item description", exact: true })
          .click();
        await staffPage.locator("#field-maps-to-2").click();
        await staffPage
          .getByRole("option", { name: "Keep in request data", exact: true })
          .click();
        await staffPage.locator("#field-show-when-2").click();
        await staffPage
          .getByRole("option", { name: "Always visible", exact: true })
          .click();
        const saved = staffPage.waitForResponse(
          (result) =>
            new URL(result.url()).pathname === path &&
            result.request().method() === "PATCH",
        );
        await staffPage
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
        expect((await saved).status()).toBe(200);
        await staffPage.reload();
        await expect(staffPage.locator("#field-show-when-2")).toContainText(
          "Always visible",
        );
        await expect(staffPage.locator("#field-maps-to-2")).toContainText(
          "Keep in request data",
        );
        const draft = await staff.request.get(
          new URL(path, fixture.origin).toString(),
        );
        expect(draft.status()).toBe(200);
        const draftData = (await draft.json()) as {
          formSchema: { fields: Array<Record<string, unknown>> };
        };
        expect(draftData.formSchema.fields[2]).not.toHaveProperty("showIf");
        expect(draftData.formSchema.fields[2]).not.toHaveProperty("mapsTo");
        // These catalog entries currently contain English text in every locale.
        // Confirm the clear controls still load from the supported French locale.
        const french = await browser.newContext({
          locale: "fr-FR",
          storageState: await staff.storageState(),
        });
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
          await expect(frenchPage.locator("#field-show-when-2")).toContainText(
            "Always visible",
          );
          await expect(frenchPage.locator("#field-maps-to-2")).toContainText(
            "Keep in request data",
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
              name: "Keep in request data",
              exact: true,
            }),
          ).toBeVisible();
        } finally {
          await french.close();
        }
        await makePublishedConditionLegacy(fixture, tenant.requestTypeId);

        const page = await customer.newPage();
        await signIn(page, portal.toString(), tenant.customer);
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
        const submitted = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/portal/submissions" &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: /^submit request$/i }).click();
        const response = await submitted;
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
        );
        expect(hiddenAttachments.status()).toBe(200);
        const hiddenRows = (await hiddenAttachments.json()) as Array<{
          filename: string;
        }>;
        expect(hiddenRows.some((row) => row.filename === fileName)).toBe(false);
        await page.reload();
        const persisted = await customer.request.get(
          new URL(`/api/portal/submissions/${ref}`, portal).toString(),
        );
        expect(persisted.status()).toBe(200);
        const data = (await persisted.json()) as {
          submission: { formData: Record<string, unknown> };
        };
        expect(data.submission.formData.quantity).toBe(42.5);
        expect(data.submission.formData).not.toHaveProperty("details");
        expect(data.submission.formData).not.toHaveProperty("evidence");

        const crafted = await postWithCsrf(
          customer.request,
          portal.toString(),
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
        );
        expect(readback.status()).toBe(200);
        const craftedData = (await readback.json()) as {
          submission: { formData: Record<string, unknown> };
        };
        expect(craftedData.submission.formData).not.toHaveProperty("details");
        expect(craftedData.submission.formData.quantity).toBe(7);

        await page.goto(new URL("/catalogue?key=access", portal).toString());
        await page.getByLabel("Summary").fill("Visible file request");
        await page.getByRole("checkbox", { name: "Include details" }).check();
        await page.getByLabel("Conditional details").fill("Visible answer");
        await page.locator("#request-field-evidence").setInputFiles({
          name: fileName,
          mimeType: "text/plain",
          buffer: bytes,
        });
        const visibleSubmission = page.waitForResponse(
          (result) =>
            new URL(result.url()).pathname === "/api/portal/submissions" &&
            result.request().method() === "POST",
        );
        await page.getByRole("button", { name: /^submit request$/i }).click();
        const visibleResponse = await visibleSubmission;
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
        );
        expect(attachments.status()).toBe(200);
        expect((await attachments.json()) as unknown[]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ filename: fileName, state: "ready" }),
          ]),
        );
      } finally {
        const cleanup = await Promise.allSettled([
          staff.close(),
          customer.close(),
        ]);
        await browser.close();
        expect(cleanup.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
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
          "a84-auth-provider",
        );
        await seedIntake(fixture, { phase: "instance" }, "a84-instance");
        await seedIntakePortal(fixture);
      },
    },
  );
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
