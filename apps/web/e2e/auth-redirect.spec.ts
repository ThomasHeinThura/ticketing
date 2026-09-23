import { expect, test } from "@playwright/test";

test("logged-out protected navigation redirects to sign-in with its target", async ({
  page,
}, testInfo) => {
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );
  await page.route("**/api/config**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      }),
    }),
  );

  const protectedPath = "/dashboard/workspace/e2e-workspace";
  await page.goto(protectedPath);
  await expect(page).toHaveURL(/\/auth\/sign-in\?/);

  const signInUrl = new URL(page.url());
  expect(signInUrl.searchParams.get("redirect")).toBe(protectedPath);
  await expect(page.getByText("Welcome back", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("auth-redirect.png") });
});
