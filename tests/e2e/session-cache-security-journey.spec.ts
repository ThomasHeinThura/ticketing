import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
} from "@playwright/test";
import { redactSecretErrorContext } from "../../apps/web/e2e/helpers/redact-secret-error-context";
import { completePendingFirstAdminInBrowser } from "./helpers/complete-bootstrap-enrollment";
import { fillSensitive } from "./helpers/fill-sensitive";
import {
  type MfaCsrfAppFixture,
  withMfaCsrfApp,
} from "./helpers/mfa-csrf-app-fixture";

/**
 * S7b: the agent shell keeps the session and a passed factor answer in the query client, so a
 * navigation does not re-read them. These journeys run against the real API, real cookies and a
 * disposable database, and show that the cache does not outlive an administrator's decision:
 *
 * 1. an administrator's session revoke reaches a user whose session is cached;
 * 2. an administrator's factor requirement reaches a user whose factor answer is cached, through
 *    the API's plain-text `403 mfa_enrollment_required`, and leads to enrolment;
 * 3. an expired step-up proof is refused by the API and the approval asks for fresh
 *    verification again, after which a fresh proof completes the action.
 *
 * Every navigation measured below is client-side (a sidebar or link click): `page.goto` reloads
 * the app and empties the cache, which would prove nothing about it.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webRequire = createRequire(resolve(repoRoot, "apps/web/package.json"));
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
const playwright = webRequire(
  "@playwright/test",
) as typeof import("@playwright/test");
const { Client } = apiRequire("pg") as typeof import("pg");
const { expect, test } = playwright;

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const SESSION_PATH = "/api/auth/get-session";
const FACTORS_PATH = "/api/me/security/factors";
const ENROLMENT_URL =
  /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/;

/** Counts the session and factor reads one page sends, for the per-navigation evidence. */
function trackAuthReads(page: Page) {
  const counts = { session: 0, factors: 0 };
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === SESSION_PATH) counts.session += 1;
    if (path === FACTORS_PATH) counts.factors += 1;
  });
  return {
    take() {
      const taken = { ...counts };
      counts.session = 0;
      counts.factors = 0;
      return taken;
    },
  };
}

type NavigationEvidence = {
  label: string;
  session: number;
  factors: number;
};

async function clientNavigate(
  page: Page,
  reads: ReturnType<typeof trackAuthReads>,
  label: string,
  pathname: string,
  evidence: NavigationEvidence[],
) {
  reads.take();
  await page
    .locator('[data-sidebar="menu-button"]', { hasText: label })
    .first()
    .click();
  await expect(page).toHaveURL(
    (url) => new URL(url.toString()).pathname === pathname,
  );
  // Let the destination's first reads start before the counts are taken.
  await page.waitForLoadState("networkidle");
  const taken = reads.take();
  evidence.push({ label, ...taken });
  return taken;
}

async function signUpWithWorkspace(
  page: Page,
  origin: string,
  input: { name: string; email: string; password: string; workspace: string },
  afterSignUp?: () => Promise<void>,
) {
  await page.goto(new URL("/auth/sign-up", origin).toString());
  await page.getByLabel("Full name").fill(input.name);
  await page.getByLabel("Email").fill(input.email);
  await page.locator('input[autocomplete="new-password"]').fill(input.password);
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/auth/sign-up/email" &&
      candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await response).status()).toBe(200);
  await afterSignUp?.();
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
  await page.getByLabel("Workspace name").fill(input.workspace);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\//);
}

async function csrfHeaders(context: APIRequestContext, origin: string) {
  const response = await context.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(200);
  const { token } = (await response.json()) as { token?: string };
  expect(Boolean(token)).toBe(true);
  return { Origin: origin, "x-taskdesk-csrf": token ?? "" };
}

async function userIdByEmail(
  admin: APIRequestContext,
  origin: string,
  email: string,
) {
  const response = await admin.get(
    new URL("/api/instance/users", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    data: Array<{ id: string; email: string }>;
  };
  const row = body.data.find((candidate) => candidate.email === email);
  expect(row).toBeDefined();
  return String(row?.id);
}

async function newMember(
  browser: Browser,
  origin: string,
  label: string,
  password: string,
) {
  const context = await browser.newContext({ locale: "en-GB" });
  const page = await context.newPage();
  const email = `s7b-${label}-${randomUUID()}@example.test`;
  await signUpWithWorkspace(page, origin, {
    name: `S7b ${label}`,
    email,
    password,
    workspace: `S7b ${label} workspace`,
  });
  return { context, page, email };
}

async function runJourney(fixture: MfaCsrfAppFixture) {
  const { origin, email: adminEmail, password } = fixture;
  const browser = await playwright.chromium.launch({ headless: true });
  const contexts: BrowserContext[] = [];
  const database = new Client({ connectionString: fixture.databaseUrl });
  await database.connect();
  const evidence: Record<string, NavigationEvidence[]> = {};
  try {
    let takeAdminBackupCode: (() => string) | null = null;
    const nextAdminBackupCode = () => {
      if (!takeAdminBackupCode)
        throw new Error(
          "Administrator enrollment did not return backup codes.",
        );
      return takeAdminBackupCode();
    };
    const adminContext = await browser.newContext({ locale: "en-GB" });
    contexts.push(adminContext);
    const adminPage = await adminContext.newPage();
    await test.step("create the bootstrap administrator", () =>
      signUpWithWorkspace(
        adminPage,
        origin,
        {
          name: "S7b administrator",
          email: adminEmail,
          password,
          workspace: "S7b administrator workspace",
        },
        async () => {
          takeAdminBackupCode = await completePendingFirstAdminInBrowser(
            adminPage,
            fixture,
          );
        },
      ));
    const admin = adminContext.request;

    await test.step("revoked session: the cached shell leaves for sign-in", async () => {
      const member = await newMember(browser, origin, "revoked", password);
      contexts.push(member.context);
      const reads = trackAuthReads(member.page);
      const steps: NavigationEvidence[] = [];
      evidence.revoke = steps;
      await clientNavigate(member.page, reads, "Inbox", "/agent/inbox", steps);
      const warm = await clientNavigate(
        member.page,
        reads,
        "My work",
        "/agent/my-work",
        steps,
      );
      // The warm navigation is served from the cache: no session or factor re-read.
      expect(warm).toEqual({ session: 0, factors: 0 });

      const memberId = await userIdByEmail(admin, origin, member.email);
      // The API refuses the revoked session (401). Watch from before the revoke: the open
      // screen's own next read may be the first refused.
      const refused = member.page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.startsWith("/api/") &&
          response.status() === 401,
      );
      const revoke = await admin.post(
        new URL(
          `/api/instance/users/${encodeURIComponent(memberId)}/sign-out`,
          origin,
        ).toString(),
        { data: {}, headers: await csrfHeaders(admin, origin) },
      );
      expect(revoke.status()).toBe(200);
      expect(
        ((await revoke.json()) as { revokedSessions: number }).revokedSessions,
      ).toBeGreaterThan(0);

      // If the open screen has not read again on its own, a navigation to a screen not yet
      // visited makes it read.
      const signedOut = await expect(member.page)
        .toHaveURL(/\/auth\/sign-in(?:\?|$)/, { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (!signedOut) {
        await member.page
          .locator('[data-sidebar="menu-button"]', { hasText: "Saved views" })
          .first()
          // A refusal landing just before the click has already left this layout; the
          // refusal and the URL below decide the outcome.
          .click({ timeout: 5_000 })
          .catch(() => undefined);
      }
      await refused;
      await expect(member.page).toHaveURL(/\/auth\/sign-in(?:\?|$)/, {
        timeout: 15_000,
      });
      // The sign-in page stays: the reload read the session again and found none.
      await member.page.waitForLoadState("networkidle");
      await expect(member.page).toHaveURL(/\/auth\/sign-in(?:\?|$)/);
      const session = await member.context.request.get(
        new URL(SESSION_PATH, origin).toString(),
        { headers: { Origin: origin } },
      );
      expect(session.status()).toBe(200);
      expect(await session.json()).toBeNull();
    });

    await test.step("expired step-up proof: the approval asks for fresh verification again", async () => {
      const targetContext = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { Origin: origin },
      });
      const targetEmail = `s7b-target-${randomUUID()}@example.test`;
      try {
        const signUp = await targetContext.post(
          new URL("/api/auth/sign-up/email", origin).toString(),
          {
            data: {
              name: "S7b deactivation target",
              email: targetEmail,
              password: `${password}-target`,
            },
            headers: { Origin: origin },
          },
        );
        expect(signUp.status()).toBe(200);
      } finally {
        await targetContext.dispose();
      }
      const targetId = await userIdByEmail(admin, origin, targetEmail);
      const requested = await admin.post(
        new URL(
          `/api/instance/users/${encodeURIComponent(targetId)}/deactivate`,
          origin,
        ).toString(),
        { data: {}, headers: await csrfHeaders(admin, origin) },
      );
      expect(requested.status()).toBe(202);
      const { pendingActionId } = (await requested.json()) as {
        pendingActionId: string;
      };

      // Reach the approval by a link, so the shell's session cache is warm.
      await adminPage.goto(
        new URL(
          "/dashboard/settings/account/pending-actions",
          origin,
        ).toString(),
      );
      await adminPage.getByRole("link", { name: "Review" }).first().click();
      await expect(adminPage).toHaveURL(
        new RegExp(
          `/dashboard/settings/account/pending-actions/${pendingActionId}$`,
        ),
      );
      await adminPage.locator("#confirm-current-email").fill(targetEmail);
      const secret = adminPage.locator("#pending-action-step-up-secret");
      await adminPage.locator("#pending-action-step-up-method").click();
      await adminPage.getByRole("option", { name: "Backup code" }).click();
      await fillSensitive(secret, nextAdminBackupCode());

      // Hold the approval request until its freshly issued proof has expired in the database.
      const approvePattern = `**/api/me/pending-actions/${pendingActionId}/approve`;
      await adminPage.route(approvePattern, async (route) => {
        const expired = await database.query(
          `UPDATE step_up_confirmation
              SET token_expires_at = now() - interval '1 second'
            WHERE pending_action_id = $1 AND state = 'issued'`,
          [pendingActionId],
        );
        expect(expired.rowCount).toBe(1);
        await route.continue();
      });
      const refusedApproval = adminPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/me/pending-actions/${pendingActionId}/approve` &&
          response.request().method() === "POST",
      );
      await adminPage
        .getByRole("button", { name: "Approve and deactivate" })
        .click();
      const refusal = await refusedApproval;
      expect(refusal.status()).toBe(403);
      expect(await refusal.text()).toContain("step_up_expired");
      await adminPage.unroute(approvePattern);

      await expect(
        adminPage.getByText(
          "You are not allowed to approve this request. The request remains pending.",
        ),
      ).toBeVisible();
      // The step-up prompt is shown again, empty, and the request is still pending.
      await expect(secret).toBeVisible();
      await expect(secret).toHaveValue("");
      const pending = await database.query<{ state: string }>(
        "SELECT state FROM pending_action WHERE id = $1",
        [pendingActionId],
      );
      expect(pending.rows).toEqual([{ state: "pending" }]);

      await adminPage.locator("#pending-action-step-up-method").click();
      await adminPage.getByRole("option", { name: "Backup code" }).click();
      await fillSensitive(secret, nextAdminBackupCode());
      const approved = adminPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/me/pending-actions/${pendingActionId}/approve` &&
          response.request().method() === "POST",
      );
      await adminPage
        .getByRole("button", { name: "Approve and deactivate" })
        .click();
      expect((await approved).status()).toBe(200);
      await expect(
        adminPage.getByText(
          "The approved deactivation completed. The user's active session was revoked.",
        ),
      ).toBeVisible();
      const executed = await database.query<{ state: string }>(
        "SELECT state FROM pending_action WHERE id = $1",
        [pendingActionId],
      );
      expect(executed.rows).toEqual([{ state: "executed" }]);
    });

    await test.step("factor requirement: the cached factor answer leads to enrolment", async () => {
      const member = await newMember(browser, origin, "factor", password);
      contexts.push(member.context);
      const reads = trackAuthReads(member.page);
      const steps: NavigationEvidence[] = [];
      evidence.factor = steps;
      await clientNavigate(member.page, reads, "Inbox", "/agent/inbox", steps);
      const warm = await clientNavigate(
        member.page,
        reads,
        "My work",
        "/agent/my-work",
        steps,
      );
      expect(warm).toEqual({ session: 0, factors: 0 });

      // Hono's HTTPException answers with the plain message, not JSON. Watch for it from
      // before the policy change: the open screen's own next read may be the first refused.
      const refusal = member.page.waitForResponse(
        async (response) =>
          new URL(response.url()).pathname.startsWith("/api/") &&
          response.status() === 403 &&
          (await response.text()).trim() === "mfa_enrollment_required",
      );
      reads.take();

      // The administrator requires a factor for everyone; this member has none. Nothing
      // signals the member's tab: the session is unchanged.
      const policy = await admin.patch(
        new URL("/api/instance/local-factor-policy", origin).toString(),
        {
          data: { mode: "required_everyone", requiredRoleId: null },
          headers: await csrfHeaders(admin, origin),
        },
      );
      expect(policy.status()).toBe(200);

      // Any API call now refuses the session. If the open screen has not read again on its
      // own, a navigation to a screen not yet visited makes it read.
      const redirected = await expect(member.page)
        .toHaveURL(ENROLMENT_URL, { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (!redirected) {
        await member.page
          .locator('[data-sidebar="menu-button"]', { hasText: "Saved views" })
          .first()
          // A refusal landing just before the click has already left this layout; the
          // refusal and the URL below decide the outcome.
          .click({ timeout: 5_000 })
          .catch(() => undefined);
      }
      await refusal;
      await expect(member.page).toHaveURL(ENROLMENT_URL, { timeout: 15_000 });
      // The refusal dropped the kept factor answer, so the route checks asked again.
      expect(reads.take().factors).toBeGreaterThan(0);
    });
  } finally {
    // Per-navigation session and factor reads (G11 / browser evidence).
    console.log(`S7b auth reads per navigation: ${JSON.stringify(evidence)}`);
    await Promise.allSettled(contexts.map((context) => context.close()));
    await Promise.allSettled([browser.close(), database.end()]);
  }
}

test("a cached agent session still follows revocation, factor policy and step-up expiry", async () => {
  // Fixture boot plus three journeys measured 2.3 to 4.5 min on a loaded host.
  test.setTimeout(480_000);
  await withMfaCsrfApp(async (fixture) => runJourney(fixture));
});
