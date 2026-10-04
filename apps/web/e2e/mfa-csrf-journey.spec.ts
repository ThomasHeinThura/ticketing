import { expect, test } from "@playwright/test";
import {
  totpForUri,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("P0 MFA and CSRF browser journey", () => {
  test("enrolls and completes authenticator and backup-code challenges", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    expect(
      totpForUri(
        "otpauth://totp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        59_000,
      ),
    ).toBe("287082");
    await withMfaCsrfApp(async ({ origin, email, password }) => {
      const signUp = new URL("/auth/sign-up", origin).toString();
      await page.goto(signUp);
      await page.getByLabel("Full name").fill("Disposable MFA Admin");
      await page.getByLabel("Email").fill(email);
      await page.locator('input[autocomplete="new-password"]').fill(password);
      const signUpResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create account" }).click();
      const signUpResponse = await signUpResponsePromise;
      expect(signUpResponse.status()).toBe(200);
      await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
      await page.getByLabel("Workspace name").fill("Disposable MFA Workspace");
      await page.getByRole("button", { name: "Create workspace" }).click();
      await expect(page).toHaveURL(/\/dashboard\/workspace\//);

      const securityPage = new URL(
        "/dashboard/settings/account/security",
        origin,
      ).toString();
      await page.goto(securityPage);
      await page.locator("#factor-password").fill(password);
      const enableResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/two-factor/enable") &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Set up authenticator" }).click();
      const enableResponse = await enableResponsePromise;
      expect(enableResponse.ok()).toBe(true);
      const enrollment = (await enableResponse.json()) as {
        totpURI?: string;
        backupCodes?: string[];
      };
      expect(
        Boolean(enrollment.totpURI && enrollment.backupCodes?.length),
      ).toBe(true);
      const provisioningUri = enrollment.totpURI ?? "";
      const backupCode = enrollment.backupCodes?.[0] ?? "";

      const cookiesBeforeEnrollment = await page.context().cookies();
      const sessionBeforeEnrollment = cookiesBeforeEnrollment.find(
        (cookie) => cookie.name === "__Host-tdk_agent_session",
      )?.value;
      const verifyEnrollmentPromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/two-factor/verify-totp") &&
          response.request().method() === "POST",
      );
      await page.locator("#enrollment-code").fill(totpForUri(provisioningUri));
      await page.getByRole("button", { name: "Verify and enable" }).click();
      const verifyEnrollmentResponse = await verifyEnrollmentPromise;
      expect(verifyEnrollmentResponse.ok()).toBe(true);
      const cookiesAfterEnrollment = await page.context().cookies();
      const sessionAfterEnrollment = cookiesAfterEnrollment.find(
        (cookie) => cookie.name === "__Host-tdk_agent_session",
      )?.value;
      expect(Boolean(sessionBeforeEnrollment)).toBe(true);
      expect(Boolean(sessionAfterEnrollment)).toBe(true);
      expect(sessionBeforeEnrollment !== sessionAfterEnrollment).toBe(true);
      const factorStatusResponse = await page.request.get(
        new URL("/api/me/security/factors", origin).toString(),
        { headers: { Origin: origin } },
      );
      expect(factorStatusResponse.status()).toBe(200);
      const factorStatus = (await factorStatusResponse.json()) as {
        enabled?: boolean;
        required?: boolean;
      };
      expect(factorStatus.enabled).toBe(true);
      expect(factorStatus.required).toBe(false);

      const signOut = async () => {
        const status = await page.evaluate(async () => {
          const response = await fetch("/api/auth/sign-out", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          return response.status;
        });
        expect(status).toBe(200);
      };
      const signInAndCompleteChallenge = async (factor: "totp" | "backup") => {
        await page.goto(new URL("/auth/sign-in", origin).toString());
        await page.getByLabel("Email").fill(email);
        await page
          .locator('input[autocomplete="current-password"]')
          .fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/\/auth\/two-factor(?:\?|$)/);
        if (factor === "backup") {
          await page.getByRole("button", { name: "Use a backup code" }).click();
        }
        await page
          .locator("#factor-code")
          .fill(factor === "totp" ? totpForUri(provisioningUri) : backupCode);
        await page.getByRole("button", { name: "Verify and sign in" }).click();
        await expect(page).toHaveURL(/\/dashboard(?:\/|\?|$)/);
      };

      await signOut();
      await signInAndCompleteChallenge("totp");
      await signOut();
      await signInAndCompleteChallenge("backup");

      type LogLevel = "error" | "warn" | "info" | "debug";
      type ObservabilitySnapshot = {
        logLevels: {
          default: LogLevel;
          modules: Partial<
            Record<
              | "http"
              | "auth"
              | "database"
              | "jobs"
              | "audit"
              | "plugins"
              | "realtime",
              LogLevel
            >
          >;
        };
        version: number;
      };
      const observabilityUrl = new URL(
        "/api/instance/observability",
        origin,
      ).toString();
      const readSettings = async (): Promise<ObservabilitySnapshot> => {
        const response = await page.request.get(observabilityUrl, {
          headers: { Origin: origin },
        });
        expect(response.status()).toBe(200);
        const body = (await response.json()) as ObservabilitySnapshot;
        return {
          logLevels: body.logLevels,
          version: body.version,
        };
      };
      const initialSettings = await readSettings();
      const changedDefault =
        initialSettings.logLevels.default === "error" ? "warn" : "error";
      const initialRealtime =
        initialSettings.logLevels.modules.realtime ??
        initialSettings.logLevels.default;
      const changedRealtime = initialRealtime === "debug" ? "info" : "debug";

      await page.goto(new URL("/god-mode/observability", origin).toString());
      const defaultLevel = page.getByLabel("Default level");
      const saveLogLevels = async () => {
        const responsePromise = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              "/api/instance/observability" &&
            response.request().method() === "PATCH",
        );
        await page.getByRole("button", { name: "Save log levels" }).click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
      };
      await defaultLevel.click();
      await page
        .getByRole("option", { name: changedDefault, exact: true })
        .click();
      await saveLogLevels();
      const changedSettings = await readSettings();
      expect(changedSettings.logLevels.default).toBe(changedDefault);
      expect(changedSettings.version > initialSettings.version).toBe(true);

      const realtimeLevel = page.getByLabel("realtime");
      await realtimeLevel.click();
      await page
        .getByRole("option", { name: changedRealtime, exact: true })
        .click();
      await realtimeLevel.press("Escape");
      await saveLogLevels();
      const changedRealtimeSettings = await readSettings();
      expect(changedRealtimeSettings.logLevels.modules.realtime).toBe(
        changedRealtime,
      );
      expect(changedRealtimeSettings.version > changedSettings.version).toBe(
        true,
      );

      await defaultLevel.click();
      await page
        .getByRole("option", {
          name: initialSettings.logLevels.default,
          exact: true,
        })
        .click();
      await saveLogLevels();
      await realtimeLevel.click();
      await page
        .getByRole("option", { name: initialRealtime, exact: true })
        .click();
      await realtimeLevel.press("Escape");
      await saveLogLevels();
      const restoredSettings = await readSettings();
      expect(restoredSettings.logLevels.default).toBe(
        initialSettings.logLevels.default,
      );
      expect(restoredSettings.logLevels.modules.realtime).toBe(initialRealtime);
      expect(restoredSettings.version > changedRealtimeSettings.version).toBe(
        true,
      );

      const csrfResponse = await page.request.get(
        new URL("/api/me/csrf-token", origin).toString(),
        { headers: { Origin: origin } },
      );
      expect(csrfResponse.status()).toBe(200);
      const csrfPayload = (await csrfResponse.json()) as { token?: string };
      const csrfToken = csrfPayload.token ?? "";
      expect(Boolean(csrfToken)).toBe(true);

      const rejectedUpdate = async (
        headers: Record<string, string>,
        expectedReason: string,
      ) => {
        const response = await page.request.patch(observabilityUrl, {
          data: {
            version: restoredSettings.version,
            logLevels: {
              ...restoredSettings.logLevels,
              default: changedDefault,
            },
          },
          headers,
          maxRedirects: 0,
        });
        expect(response.status()).toBe(403);
        const error = (await response.json()) as { message?: string };
        expect(error.message).toBe(expectedReason);
        const after = await readSettings();
        expect(after.version === restoredSettings.version).toBe(true);
        expect(after.logLevels).toEqual(restoredSettings.logLevels);
      };

      await rejectedUpdate({ Origin: origin }, "csrf_token_missing");
      await rejectedUpdate(
        {
          Origin: origin,
          "X-TaskDesk-CSRF": "intentionally-mismatched-token",
        },
        "csrf_token_mismatch",
      );
      await rejectedUpdate(
        {
          Origin: "https://foreign.invalid",
          "X-TaskDesk-CSRF": csrfToken,
        },
        "csrf_origin_invalid",
      );
    });
  });
});
