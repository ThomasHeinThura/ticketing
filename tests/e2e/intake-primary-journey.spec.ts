import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  APIRequestContext,
  Browser,
  Page,
  Response,
} from "@playwright/test";
import {
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { expect, test } = playwright;

type PortalPerson = {
  email: string;
  password: string;
  personId: string;
  organisationId: string;
};

type SeededIntakeTenant = {
  customer: PortalPerson;
  outsider: PortalPerson;
  requestTypeId: string;
  requestTypeKey: string;
  workspaceId: string;
  projectId: string;
  workItemTypeId: string;
  actual: {
    instanceFlag: { enabled: boolean; locked: boolean };
    workspaceFlag: { enabled: boolean };
    project: {
      id: string;
      workspaceId: string;
      organisationId: string | null;
    };
    requestType: {
      id: string;
      workspaceId: string;
      defaultProjectId: string | null;
      workItemTypeId: string;
    };
    assignment: { organisationId: string; requestTypeId: string };
  };
};

type FixtureProcess = Pick<
  MfaCsrfAppFixtureSetup,
  "databaseUrl" | "fixtureDir" | "spawnChild"
>;

function apiResponse(
  page: Page,
  method: string,
  pathname: string,
): Promise<Response> {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === pathname && response.request().method() === method;
  });
}

async function runPrivateCommand(
  fixture: FixtureProcess,
  command: string,
  args: string[],
  logPrefix: string,
) {
  const child = await fixture.spawnChild(
    process.execPath,
    [command, ...args],
    {
      ...process.env,
      TASKDESK_DATABASE_URL: fixture.databaseUrl,
      TASKDESK_MIGRATION_DATABASE_URL: undefined,
    },
    logPrefix,
    fixture.fixtureDir,
  );
  await new Promise<void>((resolveClose, rejectClose) => {
    child.once("close", (code) => {
      if (code === 0) resolveClose();
      else
        rejectClose(
          new Error(
            `The private ${logPrefix} setup failed (exit ${String(code)}); logs remain in the private fixture directory.`,
          ),
        );
    });
  });
}

async function seedIntakeFixture(
  fixture: FixtureProcess,
  input: Record<string, unknown>,
  name: string,
) {
  const inputPath = resolve(fixture.fixtureDir, `${name}-input.json`);
  const outputPath = resolve(fixture.fixtureDir, `${name}-output.json`);
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  await runPrivateCommand(
    fixture,
    resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"),
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

async function seedCustomerPasswordProvider(fixture: FixtureProcess) {
  await runPrivateCommand(
    fixture,
    resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"),
    [resolve(repoRoot, "tests/e2e/scripts/seed-approval-auth-provider.ts")],
    "intake-primary-customer-auth-provider",
  );
}

async function postWithCsrf(
  context: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>,
) {
  const tokenResponse = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(tokenResponse.status()).toBe(200);
  const { token } = (await tokenResponse.json()) as { token?: string };
  expect(token).toBeTruthy();
  return context.post(new URL(path, origin).toString(), {
    data,
    headers: { Origin: origin, "x-taskdesk-csrf": token ?? "" },
  });
}

async function signInThroughPortal(
  page: Page,
  portalOrigin: string,
  person: PortalPerson,
) {
  await page.goto(new URL("/auth/sign-in", portalOrigin).toString());
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-in/email");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await responsePromise).status()).toBe(200);
}

async function createStaffWorkspace(
  page: Page,
  origin: string,
): Promise<{ workspaceId: string; projectId: string; workItemTypeId: string }> {
  const api = page.context().request;
  const workspaceResponse = await postWithCsrf(api, origin, "/api/workspace", {
    name: `Intake primary ${randomUUID().slice(0, 8)}`,
  });
  expect(workspaceResponse.status()).toBe(200);
  const workspace = (await workspaceResponse.json()) as { id?: string };
  expect(workspace.id).toBeTruthy();
  const workspaceId = workspace.id ?? "";

  const projectResponse = await postWithCsrf(api, origin, "/api/project", {
    name: "Intake primary customer project",
    workspaceId,
    icon: "Folder",
    slug: `intake-primary-${randomUUID().slice(0, 8)}`,
  });
  expect(projectResponse.status()).toBe(200);
  const project = (await projectResponse.json()) as { id?: string };
  expect(project.id).toBeTruthy();

  const typesResponse = await api.get(
    new URL(
      `/api/workspace/${encodeURIComponent(workspaceId)}/work-item-types`,
      origin,
    ).toString(),
    { headers: { Origin: origin } },
  );
  expect(typesResponse.status()).toBe(200);
  const types = (await typesResponse.json()) as Array<{
    id: string;
    name: string;
  }>;
  const workItemType = types[0];
  expect(workItemType?.id).toBeTruthy();
  return {
    workspaceId,
    projectId: project.id ?? "",
    workItemTypeId: workItemType?.id ?? "",
  };
}

async function signUpStaff(
  page: Page,
  origin: string,
  fixture: MfaCsrfAppFixture,
) {
  await page.goto(new URL("/auth/sign-up", origin).toString());
  await page.getByLabel("Full name").fill("Intake primary administrator");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-up/email");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  expect((await responsePromise).status()).toBe(200);
}

async function runJourney(fixture: MfaCsrfAppFixture) {
  const portalOrigin = new URL(fixture.origin);
  portalOrigin.hostname = `portal.${portalOrigin.hostname}`;
  const portal = portalOrigin.toString();
  const browser: Browser = await playwright.chromium.launch({ headless: true });
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const returnContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const outsiderContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  try {
    const staffPage = await staffContext.newPage();
    await signUpStaff(staffPage, fixture.origin, fixture);

    const support = await createStaffWorkspace(staffPage, fixture.origin);
    const seeded = (await seedIntakeFixture(
      fixture,
      { phase: "workspace", ...support },
      "intake-primary-tenant",
    )) as SeededIntakeTenant;
    expect(seeded.requestTypeKey).toBe("access");
    expect(seeded.workspaceId).toBe(support.workspaceId);
    expect(seeded.projectId).toBe(support.projectId);
    expect(seeded.actual.instanceFlag).toEqual({
      enabled: true,
      locked: false,
    });
    expect(seeded.actual.workspaceFlag.enabled).toBe(true);
    expect(seeded.actual.project).toEqual({
      id: seeded.projectId,
      workspaceId: seeded.workspaceId,
      organisationId: seeded.customer.organisationId,
    });
    expect(seeded.actual.requestType).toEqual({
      id: seeded.requestTypeId,
      workspaceId: seeded.workspaceId,
      defaultProjectId: seeded.projectId,
      workItemTypeId: seeded.workItemTypeId,
    });
    expect(seeded.actual.assignment).toEqual({
      organisationId: seeded.customer.organisationId,
      requestTypeId: seeded.requestTypeId,
    });

    const typeUrl = new URL(
      `/agent/settings/request-types?requestTypeId=${encodeURIComponent(seeded.requestTypeId)}`,
      fixture.origin,
    ).toString();
    await staffPage.goto(typeUrl);
    await expect(staffPage.locator("#request-type-name")).toBeVisible();
    await staffPage.locator("#request-type-name").fill("Access request");
    await staffPage.locator("#request-type-group").fill("Access and accounts");
    await staffPage
      .locator("#request-type-description")
      .fill("Request access to a TaskDesk resource.");
    await staffPage.locator("#request-type-project").fill(seeded.projectId);
    await staffPage.locator("#request-type-customer-visible").click();
    await expect(
      staffPage.locator("#request-type-auto-accept"),
    ).not.toBeChecked();
    await expect(
      staffPage.locator("#request-type-force-private"),
    ).not.toBeChecked();

    await staffPage.getByRole("button", { name: "Add field" }).click();
    await staffPage.locator("#field-key-1").fill("evidence");
    await staffPage.locator("#field-label-1").fill("Evidence");
    await staffPage.locator("#field-type-1").click();
    await staffPage.getByRole("option", { name: "File", exact: true }).click();
    await expect(staffPage.locator("#field-required-1")).not.toBeChecked();

    const saveResponsePromise = apiResponse(
      staffPage,
      "PATCH",
      `/api/request-types/${encodeURIComponent(seeded.requestTypeId)}`,
    );
    await staffPage.getByRole("button", { name: "Save", exact: true }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(200);

    const publishResponsePromise = apiResponse(
      staffPage,
      "POST",
      `/api/request-types/${encodeURIComponent(seeded.requestTypeId)}/publish`,
    );
    await staffPage
      .getByRole("button", { name: "Publish", exact: true })
      .click();
    const publishResponse = await publishResponsePromise;
    expect(publishResponse.status()).toBe(200);
    const published = (await publishResponse.json()) as {
      requestType?: { published?: boolean; key?: string };
      version?: { number?: number };
    };
    expect(published.requestType).toMatchObject({
      key: "access",
      published: true,
    });
    expect(published.version?.number).toBe(1);
    await expect(staffPage).toHaveURL(typeUrl);
    await staffPage.screenshot({
      path: resolve(
        fixture.fixtureDir,
        "intake-primary-published-settings.png",
      ),
    });

    const customerPage = await customerContext.newPage();
    await signInThroughPortal(customerPage, portal, seeded.customer);
    await customerPage.goto(
      new URL("/catalogue?q=no-match&key=access", portal).toString(),
    );
    await expect(customerPage.locator("#catalogue-search")).toHaveValue(
      "no-match",
    );
    await expect(
      customerPage.getByRole("heading", { name: "Access request", level: 2 }),
    ).toBeVisible();
    await expect(customerPage.getByLabel("Summary")).toBeVisible();
    await customerPage.screenshot({
      path: resolve(
        fixture.fixtureDir,
        "intake-primary-catalogue-selected.png",
      ),
    });

    const submissionResponsePromise = apiResponse(
      customerPage,
      "POST",
      "/api/portal/submissions",
    );
    await customerPage.getByLabel("Summary").fill("Need account access");
    await customerPage
      .getByRole("button", { name: "Submit request", exact: true })
      .click();
    const submissionResponse = await submissionResponsePromise;
    expect(submissionResponse.status()).toBe(200);
    const created = (await submissionResponse.json()) as { ref?: string };
    expect(created.ref).toMatch(/^SUB-[1-9]\d*$/);
    const ref = created.ref ?? "";
    const submissionUrl = new URL(
      `/submissions/${encodeURIComponent(ref)}`,
      portal,
    ).toString();
    await expect(customerPage).toHaveURL(submissionUrl);
    await expect(customerPage.getByText("Need account access")).toBeVisible();

    const presignPromise = apiResponse(
      customerPage,
      "POST",
      `/api/portal/submissions/${encodeURIComponent(ref)}/attachments/presign`,
    );
    const storagePutPromise = customerPage.waitForResponse(
      (response) => response.request().method() === "PUT",
    );
    const completePromise = customerPage.waitForResponse((response) => {
      const pathname = new URL(response.url()).pathname;
      return (
        response.request().method() === "POST" &&
        pathname.startsWith(
          `/api/portal/submissions/${encodeURIComponent(ref)}/attachments/`,
        ) &&
        pathname.endsWith("/complete")
      );
    });
    await customerPage.locator("#submission-file-evidence").setInputFiles({
      name: "evidence.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZ8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const presignResponse = await presignPromise;
    expect(presignResponse.status()).toBe(200);
    const storagePutResponse = await storagePutPromise;
    expect(storagePutResponse.ok()).toBeTruthy();
    await expect(customerPage.getByText(/evidence\.png.*ready/i)).toBeVisible();
    // Completion is started by the UI after the real signed PUT. Do not log its URL or body.
    expect((await completePromise).status()).toBe(200);

    const triageUrl = new URL(
      `/agent/triage?state=new&ref=${encodeURIComponent(ref)}`,
      fixture.origin,
    ).toString();
    await staffPage.goto(triageUrl);
    await expect(staffPage.getByText("Need account access")).toBeVisible();
    await expect(staffPage.getByText(/evidence\.png/i)).toBeVisible();

    const claimResponsePromise = apiResponse(
      staffPage,
      "POST",
      `/api/submissions/${encodeURIComponent(ref)}/claim`,
    );
    await staffPage.getByRole("button", { name: "Claim", exact: true }).click();
    expect((await claimResponsePromise).status()).toBe(200);

    const acceptResponsePromise = apiResponse(
      staffPage,
      "POST",
      `/api/submissions/${encodeURIComponent(ref)}/accept`,
    );
    await staffPage
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    const acceptResponse = await acceptResponsePromise;
    expect(acceptResponse.status()).toBe(200);
    const accepted = (await acceptResponse.json()) as {
      state?: string;
      workItem?: {
        title?: string;
        requesterId?: string;
        workspaceId?: string;
        projectId?: string;
      };
    };
    expect(accepted.state).toBe("accepted");
    expect(accepted.workItem?.title).toBe("Need account access");
    expect(accepted.workItem?.requesterId).toBe(seeded.customer.personId);
    expect(accepted.workItem?.workspaceId).toBe(seeded.workspaceId);
    expect(accepted.workItem?.projectId).toBe(seeded.projectId);
    await expect(
      staffPage.getByText("accepted", { exact: true }),
    ).toBeVisible();
    await staffPage.screenshot({
      path: resolve(fixture.fixtureDir, "intake-primary-accepted-triage.png"),
    });

    await customerPage.reload();
    await expect(customerPage).toHaveURL(submissionUrl);
    await expect(customerPage.getByText("Need account access")).toBeVisible();
    await expect(customerPage.getByText(/evidence\.png.*ready/i)).toBeVisible();

    await customerContext.close();
    const returnPage = await returnContext.newPage();
    await signInThroughPortal(returnPage, portal, seeded.customer);
    const returningPageResponse = apiResponse(
      returnPage,
      "GET",
      `/api/portal/submissions/${encodeURIComponent(ref)}`,
    );
    await returnPage.goto(submissionUrl);
    expect((await returningPageResponse).status()).toBe(200);
    await expect(returnPage).toHaveURL(submissionUrl);
    await expect(returnPage.getByText("Need account access")).toBeVisible();
    await returnPage.screenshot({
      path: resolve(
        fixture.fixtureDir,
        "intake-primary-accepted-requester.png",
      ),
    });

    const outsiderPage = await outsiderContext.newPage();
    await signInThroughPortal(outsiderPage, portal, seeded.outsider);
    const deniedPageResponse = apiResponse(
      outsiderPage,
      "GET",
      `/api/portal/submissions/${encodeURIComponent(ref)}`,
    );
    await outsiderPage.goto(submissionUrl);
    expect((await deniedPageResponse).status()).toBe(404);
    await expect(
      outsiderPage.getByText("Need account access", { exact: true }),
    ).toHaveCount(0);
    await expect(outsiderPage.getByText(/evidence\.png/i)).toHaveCount(0);
  } finally {
    await Promise.allSettled([
      staffContext.close(),
      customerContext.close(),
      returnContext.close(),
      outsiderContext.close(),
      browser.close(),
    ]);
  }
}

test("portal intake is authored, submitted, claimed and accepted through the real UI", async () => {
  await withMfaCsrfApp(async (fixture) => runJourney(fixture), {
    beforeStart: async (setup) => {
      await seedCustomerPasswordProvider(setup);
      await seedIntakeFixture(
        setup,
        { phase: "instance" },
        "intake-primary-instance",
      );
    },
  });
});
