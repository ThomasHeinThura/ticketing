import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page, Response } from "@playwright/test";
import { fillSensitive, privateRequest } from "./fill-sensitive";
import { type MfaCsrfAppFixture, totpForUri } from "./mfa-csrf-app-fixture";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const playwright = createRequire(resolve(repoRoot, "apps/web/package.json"))(
  "@playwright/test",
) as typeof import("@playwright/test");
const { expect } = playwright;
type EnrollmentFixture = Pick<
  MfaCsrfAppFixture,
  "origin" | "email" | "password"
>;

async function protectedRequest(context: APIRequestContext, origin: string) {
  return privateRequest(() =>
    context.get(new URL("/api/instance/users", origin).toString(), {
      headers: { Origin: origin },
    }),
  );
}

async function assertPending(context: APIRequestContext, origin: string) {
  const response = await protectedRequest(context, origin);
  expect(response.status()).toBe(403);
  expect((await response.text()).trim()).toBe("mfa_enrollment_required");
}

async function assertComplete(context: APIRequestContext, origin: string) {
  expect((await protectedRequest(context, origin)).status()).toBe(200);
}

/** Create and enroll the first administrator using the product API. */
export async function completeFirstAdminViaApi(fixture: EnrollmentFixture) {
  const context = await playwright.request.newContext();
  try {
    const signup = await privateRequest(() =>
      context.post(
        new URL("/api/auth/sign-up/email", fixture.origin).toString(),
        {
          data: {
            name: "Approvals administrator",
            email: fixture.email,
            password: fixture.password,
          },
          headers: { Origin: fixture.origin },
        },
      ),
    );
    expect(signup.status()).toBe(200);
    await completePendingFirstAdminViaApi(context, fixture);
  } catch {
    throw new Error("First administrator API enrollment failed.");
  } finally {
    await context.dispose();
  }
}

/** Enroll an already signed-up pending administrator in its existing request context. */
export async function completePendingFirstAdminViaApi(
  context: APIRequestContext,
  fixture: EnrollmentFixture,
) {
  try {
    await assertPending(context, fixture.origin);
    const enabled = await privateRequest(() =>
      context.post(
        new URL("/api/auth/two-factor/enable", fixture.origin).toString(),
        {
          data: { password: fixture.password, issuer: "TaskDesk" },
          headers: { Origin: fixture.origin },
        },
      ),
    );
    expect(enabled.status()).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await privateRequest(() =>
      context.post(
        new URL("/api/auth/two-factor/verify-totp", fixture.origin).toString(),
        {
          data: { code: totpForUri(totpURI) },
          headers: { Origin: fixture.origin },
        },
      ),
    );
    expect(verified.status()).toBe(200);
    await assertComplete(context, fixture.origin);
  } catch {
    throw new Error("Pending first administrator API enrollment failed.");
  }
}

function apiResponse(page: Page, pathname: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === pathname &&
      response.request().method() === "POST",
  );
}

/** Enroll an already signed-up pending administrator through the security screen. */
export async function completePendingFirstAdminInBrowser(
  page: Page,
  fixture: EnrollmentFixture,
) {
  try {
    await expect(page).toHaveURL(
      /\/dashboard\/settings\/account\/security\?enrollmentRequired=true$/,
      { timeout: 30_000 },
    );
    await assertPending(page.context().request, fixture.origin);
    await fillSensitive(page.locator("#factor-password"), fixture.password);
    const enable = apiResponse(page, "/api/auth/two-factor/enable");
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const enabled = await enable;
    expect(enabled.status()).toBe(200);
    const { totpURI, backupCodes } = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(backupCodes.length).toBeGreaterThan(0);
    await fillSensitive(page.locator("#enrollment-code"), totpForUri(totpURI));
    const verify = apiResponse(page, "/api/auth/two-factor/verify-totp");
    await page.getByRole("button", { name: "Verify and enable" }).click();
    expect((await verify).status()).toBe(200);
    await assertComplete(page.context().request, fixture.origin);
    await page.getByRole("button", { name: "I saved these codes" }).click();
    await page.goto(new URL("/onboarding", fixture.origin).toString());
    await expect(page).toHaveURL(/\/onboarding$/);
    return () => {
      const code = backupCodes.shift();
      if (!code) throw new Error("No enrollment backup codes remain.");
      return code;
    };
  } catch {
    throw new Error("First administrator browser enrollment failed.");
  }
}
