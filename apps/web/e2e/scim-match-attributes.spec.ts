import { expect, test } from "@playwright/test";
import {
  enterVerification,
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
} from "./helpers/identity-admin-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

const SCIM = "/agent/god-mode/authentication/conn-staff?tab=scim";

test("SCIM settings save one closed request bound to the connection version @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  await expect(
    page.getByRole("heading", { name: "SCIM provisioning", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText("SCIM base URL")).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("checkbox", { name: "title" }).check();
  await page.getByRole("checkbox", { name: "displayName" }).check();
  await enterVerification(page);
  await page.getByRole("button", { name: "Save SCIM settings" }).click();
  await expect(page.getByText("SCIM settings were saved.")).toBeVisible();
  const request = {
    configVersion: 7,
    kind: "settings",
    matchAttributes: ["externalId", "userName", "displayName", "title"],
  };
  expect(fixture.challenges[0]).toEqual({
    kind: "operation",
    operation: "scim_admin_update",
    connectionId: "conn-staff",
    request,
  });
  expect(fixture.mutations).toEqual([
    {
      method: "PATCH",
      path: "/api/instance/identity-connections/conn-staff/scim",
      token: "p".repeat(43),
      body: request,
    },
  ]);
  await expect(page.getByLabel("Authenticator code")).toHaveValue("");
  await expect(page.getByText("Version 8")).toBeVisible();
});

test("a stale SCIM version keeps the draft and reloads on request", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  await page.getByRole("checkbox", { name: "title" }).check();
  fixture.connections[0].configVersion = 11;
  fixture.scim.lifecyclePolicy = "keep_memberships";
  await enterVerification(page);
  await page.getByRole("button", { name: "Save SCIM settings" }).click();
  await expect(page.getByText(/now at version 11/u)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "title" })).toBeChecked();
  await page.getByRole("button", { name: "Reload latest settings" }).click();
  await expect(page.getByRole("checkbox", { name: "title" })).not.toBeChecked();
  await expect(page.getByText("Version 11")).toBeVisible();
});

test("a rotated bearer is shown once, never in the URL, and gone after dismissal and reload @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  await enterVerification(page);
  await page.getByRole("button", { name: "Issue or rotate token" }).click();
  const bearer = page.getByLabel("New bearer token");
  await expect(bearer).toBeVisible();
  const value = await bearer.inputValue();
  expect(value).toHaveLength(43);
  expect(page.url()).not.toContain(value);
  await expect(page.getByText(/shown once/u)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  expect(fixture.challenges[0]).toEqual({
    kind: "operation",
    operation: "scim_token_rotate",
    connectionId: "conn-staff",
    version: 7,
  });
  await page.getByRole("button", { name: "I have stored the token" }).click();
  await expect(page.getByLabel("New bearer token")).toHaveCount(0);
  await page.reload();
  expect(await page.content()).not.toContain(value);
});

test("revoking with no token is a rejected no-op; enabling needs a token", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  await enterVerification(page);
  await page.getByRole("button", { name: "Revoke token" }).click();
  await expect(page.getByText(/rejected as invalid, unchanged/u)).toBeVisible();
  await enterVerification(page);
  await page.getByRole("button", { name: "Enable SCIM" }).click();
  await expect(
    page.getByText(
      "SCIM can only be enabled after a bearer token has been issued.",
    ),
  ).toBeVisible();
  expect(fixture.scim.enabled).toBe(false);
});

test("token operations report missing step-up and a stale version", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  fixture.stepUpChallengeStatus = 403;
  await enterVerification(page);
  await page.getByRole("button", { name: "Issue or rotate token" }).click();
  await expect(
    page.getByText(/Fresh verification was unavailable/u),
  ).toBeVisible();
  expect(fixture.mutations).toHaveLength(0);
  fixture.stepUpChallengeStatus = 200;
  fixture.nextMutation = {
    status: 409,
    body: { message: "version_conflict", currentVersion: 8 },
  };
  await enterVerification(page);
  await page.getByRole("button", { name: "Issue or rotate token" }).click();
  await expect(page.getByText(/now at version 8/u)).toBeVisible();
});

test("group mappings are created from URL state and edited without deletion @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  fixture.scim.enabled = true;
  await installIdentityAdminFixture(page, fixture);
  await page.goto(SCIM);
  await expect(page.getByText("Support", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /delete|remove/iu }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add group mapping" }).click();
  await expect(page).toHaveURL(/tab=scim&mapping=new$/u);
  await expect(page.getByLabel("External group ID")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel("External group ID").fill("group-finance");
  await page.getByRole("combobox", { name: "Workspace" }).click();
  await page.getByRole("option", { name: "Operations" }).click();
  await page.getByRole("combobox", { name: "Eligible role" }).click();
  await page.getByRole("option", { name: /Agent/u }).click();
  await enterVerification(page);
  await page.getByRole("button", { name: "Create mapping" }).click();
  await expect(page.getByText("The group mapping was created.")).toBeVisible();
  await expect(page).toHaveURL(/tab=scim$/u);
  expect(fixture.mutations[0]?.body).toEqual({
    configVersion: 7,
    kind: "mapping_create",
    externalGroupId: "group-finance",
    externalGroupNameSnapshot: null,
    roleId: "role-agent",
    scope: "workspace",
    scopeId: "workspace-1",
    enabled: true,
  });

  await page.getByRole("button", { name: "Edit" }).first().click();
  await expect(page).toHaveURL(/mapping=mapping-1$/u);
  await expect(page.getByLabel("External group ID")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Mapping enabled" }).uncheck();
  await enterVerification(page);
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText("The group mapping was updated.")).toBeVisible();
  expect(fixture.mutations[1]?.body).toEqual({
    configVersion: 8,
    kind: "mapping_update",
    mappingId: "mapping-1",
    enabled: false,
  });
});

test("SCIM settings denied to a non-administrator are explained", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.route("**/identity-connections/conn-staff/scim", (route) =>
    route.fulfill({
      status: 403,
      contentType: "text/plain",
      body: "Forbidden",
    }),
  );
  await page.goto(SCIM);
  await expect(page.getByText("SCIM settings unavailable")).toBeVisible();
  await expect(page.getByText(/instance administrator access/u)).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
