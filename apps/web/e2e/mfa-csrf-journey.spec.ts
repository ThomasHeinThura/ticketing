import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  totpForUri,
  withMfaCsrfApp,
} from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

async function getControlledOption(
  page: Page,
  trigger: Locator,
  name: string,
): Promise<Locator> {
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const listboxes = page.getByRole("listbox").filter({ visible: true });
  await expect(listboxes).toHaveCount(1);

  const listboxId = await trigger.getAttribute("aria-controls");
  let listbox = listboxes;
  if (listboxId !== null) {
    listbox = listboxes.and(page.locator(`[id=${JSON.stringify(listboxId)}]`));
    await expect(listbox).toHaveCount(1);
  }

  const option = listbox.getByRole("option", { name, exact: true });
  await expect(option).toHaveCount(1);
  await expect(option).toBeVisible();
  return option;
}

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
        // Sign out while the dashboard is detached. Otherwise its session
        // subscription can start an auth redirect at the same time as the
        // next explicit sign-in navigation, aborting that navigation.
        await page.goto("about:blank");
        const response = await page.request.post(
          new URL("/api/auth/sign-out", origin).toString(),
          { headers: { Origin: origin }, data: {} },
        );
        expect(response.status()).toBe(200);
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

      await test.step("MFA: sign out after enrollment", signOut);
      await test.step("MFA: complete authenticator challenge", () =>
        signInAndCompleteChallenge("totp"));
      await test.step("MFA: sign out before backup-code challenge", signOut);
      await test.step("MFA: complete backup-code challenge", () =>
        signInAndCompleteChallenge("backup"));

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
      const initialSettings = await test.step(
        "observability: read initial settings",
        readSettings,
      );
      const changedDefault =
        initialSettings.logLevels.default === "error" ? "warn" : "error";
      const initialRealtime =
        initialSettings.logLevels.modules.realtime ??
        initialSettings.logLevels.default;
      const changedRealtime = initialRealtime === "debug" ? "info" : "debug";

      await test.step("observability: open God Mode settings", () =>
        page.goto(new URL("/god-mode/observability", origin).toString()));
      const defaultLevel = page.getByLabel("Default level");
      const saveLogLevels = async (label: string) => {
        await test.step(label, async () => {
          const responsePromise = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                "/api/instance/observability" &&
              response.request().method() === "PATCH",
          );
          await page.getByRole("button", { name: "Save log levels" }).click();
          const response = await responsePromise;
          expect(response.status()).toBe(200);
        });
      };
      await test.step("observability: open default log-level options", () =>
        defaultLevel.click());
      await test.step("observability: select changed default log level", async () =>
        (
          await getControlledOption(page, defaultLevel, changedDefault)
        ).click());
      await saveLogLevels("observability: save changed default log level");
      const changedSettings = await test.step(
        "observability: read changed default setting",
        readSettings,
      );
      expect(changedSettings.logLevels.default).toBe(changedDefault);
      expect(changedSettings.version > initialSettings.version).toBe(true);

      const realtimeLevel = page.getByLabel("realtime");
      await test.step("observability: open realtime log-level options", () =>
        realtimeLevel.click());
      await test.step("observability: select changed realtime log level", async () =>
        (
          await getControlledOption(page, realtimeLevel, changedRealtime)
        ).click());
      await test.step("observability: dismiss realtime log-level options", () =>
        realtimeLevel.press("Escape"));
      await saveLogLevels("observability: save changed realtime log level");
      const changedRealtimeSettings = await test.step(
        "observability: read changed realtime setting",
        readSettings,
      );
      expect(changedRealtimeSettings.logLevels.modules.realtime).toBe(
        changedRealtime,
      );
      expect(changedRealtimeSettings.version > changedSettings.version).toBe(
        true,
      );

      await test.step("observability: reopen default log-level options", () =>
        defaultLevel.click());
      await test.step("observability: select original default log level", async () =>
        (
          await getControlledOption(
            page,
            defaultLevel,
            initialSettings.logLevels.default,
          )
        ).click());
      await saveLogLevels("observability: save restored default log level");
      await test.step("observability: reopen realtime log-level options", () =>
        realtimeLevel.click());
      await test.step("observability: select original realtime log level", async () =>
        (
          await getControlledOption(page, realtimeLevel, initialRealtime)
        ).click());
      await test.step("observability: dismiss restored realtime options", () =>
        realtimeLevel.press("Escape"));
      await saveLogLevels("observability: save restored realtime log level");
      const restoredSettings = await test.step(
        "observability: verify restored settings",
        readSettings,
      );
      expect(restoredSettings.logLevels.default).toBe(
        initialSettings.logLevels.default,
      );
      expect(restoredSettings.logLevels.modules.realtime).toBe(initialRealtime);
      expect(restoredSettings.version > changedRealtimeSettings.version).toBe(
        true,
      );

      const csrfResponse =
        await test.step("CSRF: retrieve token for rejection checks", () =>
          page.request.get(new URL("/api/me/csrf-token", origin).toString(), {
            headers: { Origin: origin },
          }));
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
