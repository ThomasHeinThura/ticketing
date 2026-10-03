import { chmod } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  totpForUri,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/bootstrap-mfa-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("P4 #229: first local signup stays pending until valid TOTP enrollment", async ({
  page,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const evidenceDir = process.env.TASKDESK_E2E_EVIDENCE_DIR;
  if (!evidenceDir) throw new Error("Private evidence directory is required.");

  await withMfaCsrfApp(
    async ({ origin, email, password, readBootstrapState }) => {
      const beforeSignup = await readBootstrapState();
      expect(beforeSignup.userCount).toBe(0);
      expect(beforeSignup.completedAt).toBeNull();
      expect(beforeSignup.setupTokenHash).not.toBeNull();

      await page.goto(new URL("/auth/sign-up", origin).toString());
      await expect(
        page.getByRole("button", { name: "Create account" }),
      ).toBeVisible();
      await page.screenshot({
        path: `${evidenceDir}/signup.png`,
        fullPage: true,
        animations: "disabled",
      });
      await chmod(`${evidenceDir}/signup.png`, 0o600);
      await page.getByLabel("Full name").fill("Disposable Bootstrap Admin");
      await page.getByLabel("Email").fill(email);
      await page.locator('input[autocomplete="new-password"]').fill(password);
      let authPostCount = 0;
      let pageErrorCount = 0;
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname.startsWith("/api/auth/")
        )
          authPostCount += 1;
      });
      page.on("pageerror", () => {
        pageErrorCount += 1;
      });
      const signupResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.startsWith("/api/auth/") &&
          response.request().method() === "POST",
        { timeout: 30_000 },
      );
      await page.getByRole("button", { name: "Create account" }).click();
      let signupResponse: Awaited<typeof signupResponsePromise>;
      try {
        signupResponse = await signupResponsePromise;
      } catch {
        const validation = await page
          .locator("[data-slot='form-message']")
          .allTextContents();
        const nativeValidity = await page
          .locator("form")
          .evaluate((form) => (form as HTMLFormElement).checkValidity());
        const alerts = await page.getByRole("alert").count();
        throw new Error(
          `Signup submitted no auth response; formValid=${nativeValidity}; visibleValidationMessages=${validation.length}; alerts=${alerts}; authPosts=${authPostCount}; pageErrors=${pageErrorCount}`,
        );
      }
      expect(signupResponse.ok()).toBe(true);
      await expect
        .poll(async () => (await readBootstrapState()).userCount)
        .toBe(1);
      await page.goto(
        new URL("/dashboard/settings/account/security", origin).toString(),
      );
      const pendingStatusResponse = await page.request.get(
        new URL("/api/me/security/factors", origin).toString(),
        { headers: { Origin: origin } },
      );
      expect(pendingStatusResponse.status()).toBe(200);
      const pendingStatus = (await pendingStatusResponse.json()) as {
        enabled: boolean;
        required: boolean;
        bootstrapRequired: boolean;
        policyMode: string;
      };
      expect(pendingStatus).toEqual({
        enabled: false,
        required: true,
        bootstrapRequired: true,
        policyMode: "off",
      });

      const protectedResponse = await page.request.get(
        new URL("/api/workspace", origin).toString(),
        { headers: { Origin: origin }, maxRedirects: 0 },
      );
      expect(protectedResponse.status()).toBe(403);
      expect(await protectedResponse.text()).toBe("mfa_enrollment_required");

      await page.locator("#factor-password").fill(password);
      const enableResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/two-factor/enable") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Set up authenticator" }).click();
      const enableResponse = await enableResponsePromise;
      expect(enableResponse.ok()).toBe(true);
      const enrollment = (await enableResponse.json()) as { totpURI?: string };
      expect(typeof enrollment.totpURI).toBe("string");
      const provisioningUri = enrollment.totpURI ?? "";

      const validCode = totpForUri(provisioningUri);
      const wrongCode = validCode === "000000" ? "000001" : "000000";
      await page.locator("#enrollment-code").fill(wrongCode);
      const wrongVerifyPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/two-factor/verify-totp") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Verify and enable" }).click();
      const wrongVerifyResponse = await wrongVerifyPromise;
      expect(wrongVerifyResponse.status()).toBeGreaterThanOrEqual(400);
      expect(wrongVerifyResponse.status()).toBeLessThan(500);
      const afterWrongCode = await readBootstrapState();
      expect(afterWrongCode.completedAt).toBeNull();
      expect(afterWrongCode.setupTokenHash).not.toBeNull();
      await expect(page.locator("#enrollment-code")).toBeVisible();

      await page.locator("#enrollment-code").fill(totpForUri(provisioningUri));
      const validVerifyPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/two-factor/verify-totp") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Verify and enable" }).click();
      expect((await validVerifyPromise).ok()).toBe(true);

      await expect(
        page.getByRole("heading", { name: "Authenticator factor enabled" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "I saved these codes" }).click();
      const enabledStatusResponse = await page.request.get(
        new URL("/api/me/security/factors", origin).toString(),
        { headers: { Origin: origin } },
      );
      expect(enabledStatusResponse.status()).toBe(200);
      const enabledStatus = (await enabledStatusResponse.json()) as {
        enabled: boolean;
        required: boolean;
        bootstrapRequired: boolean;
        policyMode: string;
      };
      expect(enabledStatus).toEqual({
        enabled: true,
        required: false,
        bootstrapRequired: false,
        policyMode: "off",
      });
      const afterValidCode = await readBootstrapState();
      expect(afterValidCode.userCount).toBe(1);
      expect(afterValidCode.completedAt).not.toBeNull();
      expect(afterValidCode.setupTokenHash).toBeNull();
      expect(afterValidCode.setupTokenExpiresAt).toBeNull();

      await page.screenshot({
        path: `${evidenceDir}/account-security.png`,
        fullPage: true,
        animations: "disabled",
        mask: [
          page.getByText("Disposable Bootstrap Admin", { exact: true }),
          page.getByText(email, { exact: true }),
        ],
      });
      await chmod(`${evidenceDir}/account-security.png`, 0o600);
    },
  );
});
