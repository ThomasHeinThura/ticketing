import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import {
  fixtureOwnershipJournal,
  type MfaCsrfAppFixture,
  type MfaCsrfAppFixtureSetup,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "./helpers/project-key";
import { safePortalOperation } from "./helpers/safe-portal-operation";

/**
 * U-12 / A-03, A-07, A-08: the portal request conversation, end to end on the real API,
 * database and both web builds, on the filesystem storage driver.
 *
 * Staff raise a request and name the customer with the agent Requester field (A-03), then ask
 * a public question (an internal note stays internal). The customer opens it from the case list,
 * reads the public conversation and replies with a file through the portal-bound upload link
 * (A-08, CP-19); staff see the reply and the file on the work item, byte for byte. Staff share a
 * file in the agent composer (Public comment, "Share these files with the customer" on) and the
 * customer downloads it through the portal-bound download link, byte for byte (A-07). Another
 * organisation's customer gets "not found" (CP-2). Axe runs on the page (G4), light and dark,
 * desktop, tablet and mobile.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { expect, test } = playwright;
const uiRequire = createRequire(resolve(repoRoot, "packages/ui/package.json"));
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

type PortalPerson = {
  email: string;
  password: string;
  personId: string;
  organisationId: string;
};

type FixtureProcess = Pick<
  MfaCsrfAppFixtureSetup,
  "databaseUrl" | "fixtureDir" | "spawnChild"
>;

const PDF_BYTES = Buffer.from("%PDF-1.4\n%portal conversation\n%%EOF\n");
const REPLY_BYTES = Buffer.from("%PDF-1.4\n%customer reply file\n%%EOF\n");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function doc(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

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
  args: string[],
  logPrefix: string,
) {
  const child = await fixture.spawnChild(
    process.execPath,
    [resolve(repoRoot, "apps/api/node_modules/tsx/dist/cli.mjs"), ...args],
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

async function seedScript(
  fixture: FixtureProcess,
  script: string,
  input: Record<string, unknown>,
  name: string,
) {
  const inputPath = resolve(fixture.fixtureDir, `${name}-input.json`);
  const outputPath = resolve(fixture.fixtureDir, `${name}-output.json`);
  writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  await runPrivateCommand(
    fixture,
    [
      "--tsconfig",
      resolve(repoRoot, "apps/api/tsconfig.tests.json"),
      resolve(repoRoot, script),
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

async function signUpStaff(page: Page, fixture: MfaCsrfAppFixture) {
  await page.goto(new URL("/auth/sign-up", fixture.origin).toString());
  await page.getByLabel("Full name").fill("Portal conversation agent");
  await page.getByLabel("Email").fill(fixture.email);
  await page.locator('input[name="password"]').fill(fixture.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-up/email");
  await page.getByRole("button", { name: /^create account$/i }).click();
  expect((await responsePromise).status()).toBe(200);
}

async function createStaffWorkspace(page: Page, origin: string) {
  const api = page.context().request;
  // D-A: only an instance administrator creates a workspace, and the request names its owner.
  // The signed-in user here is the bootstrap administrator, so they name themselves.
  const sessionResponse = await api.get(
    new URL("/api/auth/get-session", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(sessionResponse.status()).toBe(200);
  const ownerUserId =
    (
      (await sessionResponse.json()) as {
        user?: { id?: string };
      } | null
    )?.user?.id ?? "";
  expect(ownerUserId).toBeTruthy();
  const workspaceResponse = await postWithCsrf(api, origin, "/api/workspace", {
    name: `Portal conversation ${randomUUID().slice(0, 8)}`,
    ownerUserId,
  });
  expect(workspaceResponse.status()).toBe(200);
  const workspace = (await workspaceResponse.json()) as { id?: string };
  const workspaceId = workspace.id ?? "";
  expect(workspaceId).toBeTruthy();
  const projectResponse = await postWithCsrf(api, origin, "/api/project", {
    name: "Portal conversation customer project",
    workspaceId,
    icon: "Folder",
    slug: uniqueProjectKey(),
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
  const types = (await typesResponse.json()) as Array<{ id: string }>;
  return {
    workspaceId,
    projectId: project.id ?? "",
    workItemTypeId: types[0]?.id ?? "",
  };
}

async function signInThroughPortal(
  page: Page,
  portalOrigin: string,
  person: PortalPerson,
) {
  await page.goto(new URL("/sign-in", portalOrigin).toString());
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  const responsePromise = apiResponse(page, "POST", "/api/auth/sign-in/email");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  expect((await responsePromise).status()).toBe(200);
  // A refused portal identity also answers 200 but revokes the session and clears its cookie;
  // fail here, not at a later redirect to /sign-in. Only booleans reach the assertion output.
  const sessionResponse = await page
    .context()
    .request.get(new URL("/api/auth/get-session", portalOrigin).toString());
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as {
    session?: unknown;
  } | null;
  expect(Boolean(session?.session)).toBe(true);
}

async function expectNoSeriousAxeViolations(page: Page) {
  await page.addScriptTag({ content: axeCoreSource });
  const violations = await page.evaluate(async () => {
    type BrowserAxe = {
      run: (context: Document) => Promise<{
        violations: Array<{ id: string; impact: string | null }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    const result = await axe.run(document);
    return result.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact }) => ({ id, impact }));
  });
  expect(violations).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function runJourney(
  fixture: MfaCsrfAppFixture,
  evidencePath: (name: string) => string,
) {
  const portalOrigin = new URL(fixture.origin);
  portalOrigin.hostname = `portal.${portalOrigin.hostname}`;
  const portal = portalOrigin.toString();
  const browser = await playwright.chromium.launch({ headless: true });
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const outsiderContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  try {
    const staffPage = await staffContext.newPage();
    await signUpStaff(staffPage, fixture);
    const support = await createStaffWorkspace(staffPage, fixture.origin);
    const tenant = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-intake-primary.ts",
      { phase: "workspace", ...support },
      "portal-conversation-tenant",
    )) as { customer: PortalPerson; outsider: PortalPerson };

    // Staff raise the request through the real API.
    const staffApi = staffPage.context().request;
    const created = await postWithCsrf(
      staffApi,
      fixture.origin,
      `/api/projects/${support.projectId}/work-items`,
      { typeId: support.workItemTypeId, title: "Confirm the new VPN profile" },
    );
    expect(created.status()).toBe(200);
    const { id: workItemId } = (await created.json()) as { id: string };
    const request = (await seedScript(
      fixture,
      "tests/e2e/scripts/seed-portal-request.ts",
      { workItemId, staffEmail: fixture.email },
      "portal-conversation-request",
    )) as { key: string };

    // A-03: staff name the customer as requester with the agent Requester field.
    await staffPage.goto(
      new URL(`/agent/work-items/${request.key}`, fixture.origin).toString(),
    );
    const requesterControl = staffPage.getByTestId(
      "work-item-requester-control",
    );
    await expect(requesterControl).toHaveAccessibleName(
      "Requester: No requester",
    );
    await requesterControl.click();
    await staffPage
      .getByRole("textbox", { name: "Search customers" })
      .fill(tenant.customer.email);
    const requesterSaved = apiResponse(
      staffPage,
      "PATCH",
      `/api/work-items/${request.key}`,
    );
    await staffPage
      .getByRole("button", {
        name: new RegExp(escapeRegExp(tenant.customer.email), "u"),
      })
      .click();
    expect((await requesterSaved).status()).toBe(200);
    await expect(requesterControl).not.toHaveAccessibleName(
      "Requester: No requester",
    );
    await expect(
      staffPage.getByRole("textbox", { name: "Search customers" }),
    ).toHaveCount(0);
    await staffPage.screenshot({
      path: evidencePath("agent-requester-set.png"),
      fullPage: true,
    });

    const question = await postWithCsrf(
      staffApi,
      fixture.origin,
      `/api/work-items/${request.key}/comments`,
      { body: doc("Can you test it today?"), visibility: "public" },
    );
    expect(question.status()).toBe(200);
    const internal = await postWithCsrf(
      staffApi,
      fixture.origin,
      `/api/work-items/${request.key}/comments`,
      { body: doc("INTERNAL NOTE for the team"), visibility: "internal" },
    );
    expect(internal.status()).toBe(200);

    // The customer opens it from the case list.
    const page = await customerContext.newPage();
    await signInThroughPortal(page, portal, tenant.customer);
    await page.goto(new URL("/requests", portal).toString());
    const detailResponse = apiResponse(
      page,
      "GET",
      `/api/portal/requests/${request.key}`,
    );
    await page.getByRole("link", { name: request.key }).first().click();
    const detail = await detailResponse;
    expect(detail.status()).toBe(200);
    expect(await detail.text()).not.toContain("INTERNAL NOTE");
    await expect(page).toHaveURL(new RegExp(`/requests/${request.key}$`, "u"));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Confirm the new VPN profile",
      }),
    ).toBeVisible();
    await expect(page.getByText("Can you test it today?")).toBeVisible();
    await expect(page.getByText("INTERNAL NOTE")).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-request-desktop-light.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expectNoSeriousAxeViolations(page);
    await page.screenshot({
      path: evidencePath("portal-request-desktop-dark.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });

    // The customer replies with a file, by keyboard. CP-19: the file goes through a portal-bound
    // upload link on the portal host.
    await page.getByLabel("Reply", { exact: true }).fill("Tested, it works.");
    await page.getByLabel("Attach files", { exact: true }).setInputFiles({
      name: "vpn-test.pdf",
      mimeType: "application/pdf",
      buffer: REPLY_BYTES,
    });
    await expect(
      page
        .getByRole("list", { name: "Files to send" })
        .getByText("vpn-test.pdf"),
    ).toBeVisible();
    const replyResponse = apiResponse(
      page,
      "POST",
      `/api/portal/requests/${request.key}/comments`,
    );
    const uploadResponse = apiResponse(
      page,
      "PUT",
      "/api/storage/portal-attachment-upload",
    );
    const completeResponse = page.waitForResponse(
      (response) =>
        /^\/api\/portal\/requests\/[^/]+\/attachments\/[^/]+\/complete$/u.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send reply" }).focus();
    await page.keyboard.press("Enter");
    expect((await replyResponse).status()).toBe(200);
    const upload = await uploadResponse;
    expect(upload.status()).toBe(204);
    expect(new URL(upload.url()).host).toBe(new URL(portal).host);
    const replyFile = await completeResponse;
    expect(replyFile.status()).toBe(200);
    const { id: replyFileId } = (await replyFile.json()) as { id: string };
    const thread = page
      .getByRole("list")
      .filter({ hasText: "Tested, it works." });
    await expect(thread.getByText("Tested, it works.")).toBeVisible();
    await expect(page.getByText("vpn-test.pdf")).toBeVisible();

    // Staff see the reply and its file on the work item, with the same bytes.
    await staffPage.goto(
      new URL(`/agent/work-items/${request.key}`, fixture.origin).toString(),
    );
    await expect(staffPage.getByText("Tested, it works.")).toBeVisible();
    await expect(staffPage.getByText("vpn-test.pdf").first()).toBeVisible();
    const staffCopy = await staffApi.get(
      new URL(`/api/attachments/${replyFileId}`, fixture.origin).toString(),
      { headers: { Origin: fixture.origin } },
    );
    expect(staffCopy.status()).toBe(200);
    expect(Buffer.from(await staffCopy.body()).equals(REPLY_BYTES)).toBe(true);

    // Staff share a file from the agent composer: a Public comment with the file staged and
    // "Share these files with the customer" switched on (A-07).
    const activity = staffPage.getByTestId("work-item-activity");
    const composer = activity.getByTestId("work-item-comment-composer");
    await composer
      .getByRole("group", { name: "Who can see this comment?" })
      .getByRole("button", { name: "Public", exact: true })
      .click();
    await composer
      .locator(".taskdesk-comment-editor-content [contenteditable='true']")
      .fill("Here is the guide.");
    await composer.locator('input[type="file"]').setInputFiles({
      name: "vpn-guide.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    await expect(composer.getByText("vpn-guide.pdf")).toBeVisible();
    const share = composer.getByRole("switch", {
      name: "Share these files with the customer",
    });
    await expect(share).toBeVisible();
    await share.click();
    await expect(share).toBeChecked();
    const [presigned, completed] = await Promise.all([
      staffPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/work-items/${request.key}/attachments/presign` &&
          response.request().method() === "POST",
      ),
      staffPage.waitForResponse(
        (response) =>
          /^\/api\/attachments\/[^/]+\/complete$/u.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "POST",
      ),
      composer.getByRole("button", { name: "Send comment" }).click(),
    ]);
    expect(presigned.status()).toBe(200);
    expect(completed.status()).toBe(200);

    // The portal lists only customer-visible files (AT-3), so the file showing up below proves
    // the Switch shared it.
    await page.reload();
    await expect(page.getByText("Here is the guide.")).toBeVisible();
    await expect(page.getByText("vpn-guide.pdf")).toBeVisible();
    // CP-19: the customer downloads it through a portal-bound link, byte for byte.
    await expect(
      page.getByText(
        "Not available to download here yet. Ask the team if you need it.",
      ),
    ).toHaveCount(0);
    const [download] = await safePortalOperation(() =>
      Promise.all([
        page.waitForEvent("download"),
        (async () => {
          await page
            .getByLabel("Download vpn-guide.pdf", { exact: true })
            .focus();
          await page.keyboard.press("Enter");
        })(),
      ]),
    );
    expect(download.suggestedFilename()).toBe("vpn-guide.pdf");
    expect(new URL(download.url()).pathname).toBe(
      "/api/storage/portal-download",
    );
    expect(
      readFileSync(await safePortalOperation(() => download.path())).equals(
        PDF_BYTES,
      ),
    ).toBe(true);
    const issuedUrl = new URL(download.url());
    expect(issuedUrl.origin).toBe(new URL(portal).origin);
    const expiry = Number(issuedUrl.searchParams.get("expires"));
    expect(expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(expiry).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 300);
    const head = await safePortalOperation(() =>
      customerContext.request.head(issuedUrl.toString()),
    );
    expect(head.status()).toBe(200);
    expect(head.headers()["content-length"]).toBe(String(PDF_BYTES.length));
    expect((await safePortalOperation(() => head.body())).length).toBe(0);
    const partial = await safePortalOperation(() =>
      customerContext.request.get(issuedUrl.toString(), {
        headers: { Range: "bytes=1-4" },
      }),
    );
    expect(partial.status()).toBe(206);
    expect(partial.headers()["content-range"]).toBe(
      `bytes 1-4/${PDF_BYTES.length}`,
    );
    expect(
      Buffer.from(await safePortalOperation(() => partial.body())).equals(
        PDF_BYTES.subarray(1, 5),
      ),
    ).toBe(true);
    const unsatisfiable = await safePortalOperation(() =>
      customerContext.request.get(issuedUrl.toString(), {
        headers: { Range: `bytes=${PDF_BYTES.length}-` },
      }),
    );
    expect(unsatisfiable.status()).toBe(416);
    expect(unsatisfiable.headers()["content-range"]).toBe(
      `bytes */${PDF_BYTES.length}`,
    );
    const wrongHost = new URL(issuedUrl);
    wrongHost.host = new URL(fixture.origin).host;
    expect(
      (
        await safePortalOperation(() =>
          customerContext.request.get(wrongHost.toString()),
        )
      ).status(),
    ).toBe(404);

    // Tablet and mobile: no horizontal page scroll.
    for (const viewport of [
      { width: 820, height: 1180, name: "tablet" },
      { width: 390, height: 844, name: "mobile" },
    ]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoHorizontalScroll(page);
        await page.screenshot({
          path: evidencePath(
            `portal-request-${viewport.name}-${colorScheme}.png`,
          ),
          fullPage: true,
        });
      }
    }

    // CP-2: another organisation's customer gets "not found".
    const outsiderPage = await outsiderContext.newPage();
    await signInThroughPortal(outsiderPage, portal, tenant.outsider);
    expect(
      (
        await safePortalOperation(() =>
          outsiderContext.request.get(issuedUrl.toString()),
        )
      ).status(),
    ).toBe(400);
    const foreign = apiResponse(
      outsiderPage,
      "GET",
      `/api/portal/requests/${request.key}`,
    );
    await outsiderPage.goto(
      new URL(`/requests/${request.key}`, portal).toString(),
    );
    expect((await foreign).status()).toBe(404);
    await expect(
      outsiderPage.getByRole("heading", {
        level: 1,
        name: "We could not find this request",
      }),
    ).toBeVisible();
    await expect(outsiderPage.getByText("Can you test it today?")).toHaveCount(
      0,
    );

    // Removing the requester revokes reach after the link has already been issued.
    await requesterControl.click();
    const revoked = apiResponse(
      staffPage,
      "PATCH",
      `/api/work-items/${request.key}`,
    );
    await staffPage
      .getByRole("button", { name: "No requester", exact: true })
      .click();
    expect((await revoked).status()).toBe(200);
    await expect(requesterControl).toHaveAccessibleName(
      "Requester: No requester",
    );
    expect(
      (
        await safePortalOperation(() =>
          customerContext.request.get(issuedUrl.toString()),
        )
      ).status(),
    ).toBe(404);
  } finally {
    await Promise.allSettled([
      staffContext.close(),
      customerContext.close(),
      outsiderContext.close(),
      browser.close(),
    ]);
  }
}

test("staff raise a request for a customer, who opens it, replies with a file and downloads the team's file in the portal", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(240_000);
  await withMfaCsrfApp(
    async (fixture) => runJourney(fixture, (name) => testInfo.outputPath(name)),
    {
      ...fixtureOwnershipJournal(
        testInfo.outputPath("fixture-ownership.jsonl"),
      ),
      beforeStart: async (setup) => {
        await runPrivateCommand(
          setup,
          [
            resolve(
              repoRoot,
              "tests/e2e/scripts/seed-approval-auth-provider.ts",
            ),
          ],
          "portal-conversation-customer-auth-provider",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-intake-primary.ts",
          { phase: "instance" },
          "portal-conversation-instance",
        );
        await seedScript(
          setup,
          "tests/e2e/scripts/seed-portal-projects.ts",
          { phase: "instance" },
          "portal-conversation-portal-flag",
        );
      },
    },
  );
});
