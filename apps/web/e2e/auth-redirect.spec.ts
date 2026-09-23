import { expect, test } from "@playwright/test";

test("logged-out protected navigation redirects to sign-in with its target", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null",
    }),
  );

  const protectedPath = "/dashboard/workspace/e2e-workspace";
  await page.goto(protectedPath);
  await expect(page).toHaveURL(/\/auth\/sign-in\?/);

  const signInUrl = new URL(page.url());
  expect(signInUrl.searchParams.get("redirect")).toBe(protectedPath);
});
