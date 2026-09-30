import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const uiRequire = createRequire(
  new URL("../../../packages/ui/package.json", import.meta.url),
);
const axeCoreSource = readFileSync(
  uiRequire.resolve("axe-core/axe.min.js"),
  "utf8",
);

const authenticatedSession = {
  session: {
    id: "mfa-e2e-session",
    userId: "mfa-e2e-user",
    expiresAt: "2030-01-01T00:00:00.000Z",
    token: "mfa-e2e-token",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
  user: {
    id: "mfa-e2e-user",
    name: "MFA Browser Test",
    email: "mfa-browser@example.test",
    emailVerified: true,
    twoFactorEnabled: false,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    role: "user",
  },
};

async function expectNoSeriousA11yViolations(
  page: import("@playwright/test").Page,
) {
  await page.addScriptTag({ content: axeCoreSource });
  const violations = await page.evaluate(async () => {
    type BrowserAxe = {
      run: (context: Document) => Promise<{
        violations: Array<{
          id: string;
          impact: string | null;
          help: string;
          nodes: Array<{ target: string[]; failureSummary?: string }>;
        }>;
      }>;
    };
    const axe = (window as typeof window & { axe: BrowserAxe }).axe;
    return (await axe.run(document)).violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      }));
  });
  expect(violations).toEqual([]);
}

test("MFA challenge opens, switches to backup code, and rejects malformed TOTP locally @a11y", async ({
  page,
}, testInfo) => {
  let verificationRequested = false;
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page.route("**/api/auth/two-factor/verify-totp", (route) => {
    verificationRequested = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto("/auth/mfa?redirect=%2Fdashboard");
  await expect(
    page.getByText("Two-factor authentication", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await expect(page.getByLabel("Backup code")).toBeVisible();
  await page.getByRole("button", { name: "Use an authenticator code" }).click();
  await page.getByLabel("Authenticator code").fill("123");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(verificationRequested).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("mfa-challenge.png") });
  await expectNoSeriousA11yViolations(page);
});

test("MFA enrollment shows setup key, verifies, and displays one-time backup codes @a11y", async ({
  page,
}, testInfo) => {
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authenticatedSession),
    }),
  );
  await page.route("**/api/auth/list-accounts**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ providerId: "credential" }]),
    }),
  );
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      password: "test-password",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totpURI:
          "otpauth://totp/TaskDesk%3Amfa-browser%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=TaskDesk",
        backupCodes: ["AAAA-BBBB", "CCCC-DDDD"],
      }),
    });
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: "123456" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: authenticatedSession.user }),
    });
  });

  await page.goto("/auth/mfa/enrol?redirect=%2Fdashboard");
  await expect(
    page.getByText("Protect your account", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Confirm your password").fill("test-password");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify and enable" }).click();
  await expect(page.getByText("AAAA-BBBB")).toBeVisible();
  await expect(page.getByText("CCCC-DDDD")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mfa-backup-codes.png") });
  await expectNoSeriousA11yViolations(page);
});
