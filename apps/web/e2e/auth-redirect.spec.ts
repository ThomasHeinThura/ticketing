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

test("logged-out protected navigation redirects to sign-in with its target @a11y", async ({
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

  await page.addScriptTag({ content: axeCoreSource });
  const seriousOrCriticalViolations = await page.evaluate(async () => {
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
    const { violations } = await axe.run(document);
    return violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes }));
  });
  expect(seriousOrCriticalViolations).toEqual([]);
});
