import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
} from "./helpers/identity-admin-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

const EVENTS = "/agent/god-mode/authentication/conn-staff";

test("provisioning history pages through a URL cursor that survives a reload @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${EVENTS}?tab=events`);
  await expect(
    page.getByRole("tab", { name: "Provisioning history", selected: true }),
  ).toBeVisible();
  await expect(page.getByText("Token rotated")).toBeVisible();
  await expect(page.getByText("User created")).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Older events" }).click();
  await expect(page).toHaveURL(/tab=events&eventsCursor=cursor-1$/u);
  await expect(page.getByText("Request denied")).toBeVisible();
  await expect(page.getByText("Token rotated")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Request denied")).toBeVisible();
  await page.getByRole("button", { name: "Newest events" }).click();
  await expect(page).toHaveURL(/tab=events$/u);
  await expect(page.getByText("Token rotated")).toBeVisible();
});

test("shows only safe summaries and an empty state when there is no history", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  fixture.eventPages = [[]];
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${EVENTS}?tab=events`);
  await expect(page.getByText("No events")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("tab selection is URL state and a failed history load is retryable", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(EVENTS);
  await page.getByRole("tab", { name: "Provisioning history" }).click();
  await expect(page).toHaveURL(/tab=events$/u);
  await page.getByRole("tab", { name: "Connection" }).click();
  await expect(page).toHaveURL(new RegExp(`${EVENTS}$`, "u"));
  await page.route("**/identity-connections/conn-staff/events**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
  );
  await page.goto(`${EVENTS}?tab=events`);
  await expect(
    page.getByText(/Event history could not be loaded/u),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
