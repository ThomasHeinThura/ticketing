import { expect, type Page } from "@playwright/test";
import { totpForUri } from "../../../../tests/e2e/helpers/mfa-csrf-app-fixture";

/** Complete the first administrator's required enrollment before onboarding. */
export async function enrollFirstAdmin(
  page: Page,
  origin: string,
  password: string,
) {
  await expect(page).toHaveURL(
    /\/dashboard\/settings\/account\/security\?enrollmentRequired=true/,
  );
  await page.locator("#factor-password").fill(password);
  const enable = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/two-factor/enable") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const enabled = await enable;
  expect(enabled.ok()).toBe(true);
  const enrollment = (await enabled.json()) as {
    totpURI?: string;
    backupCodes?: string[];
  };
  expect(Boolean(enrollment.totpURI && enrollment.backupCodes?.length)).toBe(
    true,
  );
  const provisioningUri = enrollment.totpURI ?? "";
  const backupCodes = enrollment.backupCodes ?? [];
  expect(provisioningUri.startsWith("otpauth://totp/")).toBe(true);
  expect(backupCodes.length).toBeGreaterThanOrEqual(3);
  const before = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__Host-tdk_agent_session",
  )?.value;
  const verify = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/two-factor/verify-totp") &&
      response.request().method() === "POST",
  );
  await page.locator("#enrollment-code").fill(totpForUri(provisioningUri));
  await page.getByRole("button", { name: "Verify and enable" }).click();
  expect((await verify).ok()).toBe(true);
  const after = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__Host-tdk_agent_session",
  )?.value;
  expect(Boolean(before && after && before !== after)).toBe(true);
  const save = page.getByRole("button", { name: "I saved these codes" });
  await expect(save).toBeVisible();
  await expect
    .poll(() => page.locator('[role="alert"] li').count())
    .toBeGreaterThanOrEqual(3);
  await save.click();
  await expect(save).toBeHidden();
  await page.goto(new URL("/onboarding", origin).toString());
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
  return { provisioningUri, backupCodes };
}

/** Create and activate the first workspace through onboarding's real UI. */
export async function createFirstWorkspace(page: Page, name: string) {
  await page.getByLabel("Workspace name").fill(name);
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/workspace" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create workspace" }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const workspace = (await response.json()) as { id: string; name: string };
  expect(workspace.id).toBeTruthy();
  expect(workspace.name).toBe(name);
  await expect(page).toHaveURL(/\/agent(?:\?|$)/);
  // /agent no longer carries the workspace id. The shell resolves it from
  // the authenticated session; also prove onboarding activated the one created.
  await expect
    .poll(async () => {
      const session = await page.request.get(
        new URL("/api/auth/get-session", page.url()).toString(),
      );
      expect(session.ok()).toBe(true);
      const body = (await session.json()) as {
        session: { activeOrganizationId: string | null };
      };
      return body.session.activeOrganizationId;
    })
    .toBe(workspace.id);
  return workspace.id;
}
