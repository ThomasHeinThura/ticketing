import { expect, test } from "@playwright/test";
import {
  CLIENT_ID,
  enterVerification,
  expectNoSeriousAxeViolations,
  installIdentityAdminFixture,
  newIdentityFixture,
  TENANT_ID,
} from "./helpers/identity-admin-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

const LIST = "/agent/god-mode/authentication";

test("list shows staff and customer connections and customer ones are not editable here @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await expect(
    page.getByRole("heading", { name: "Authentication providers", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Staff Entra")).toBeVisible();
  await expect(page.getByText("Contoso customers")).toBeVisible();
  await expect(
    page.getByText(
      "Customer connections are configured from the organisation's Identity tab.",
    ),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("link", { name: "View" }).click();
  await expect(page).toHaveURL(`${LIST}/conn-customer`);
  await expect(page.getByText("Managed from the organisation")).toBeVisible();
  await expect(page.getByLabel("Connection name")).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
});

test("editing a connection proves the exact change, sends only changed fields and clears the secret @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await page.getByRole("link", { name: "Manage settings" }).click();
  await expect(page).toHaveURL(`${LIST}/conn-staff`);
  await expect(
    page.getByRole("heading", { name: "Staff Entra", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Configuration version")).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByLabel("Connection name").fill("Staff Entra renamed");
  await enterVerification(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Identity connection saved")).toBeVisible();
  await expect(page.getByText(/now at version 8/u)).toBeVisible();

  const request = { configVersion: 7, displayName: "Staff Entra renamed" };
  expect(fixture.challenges).toEqual([
    {
      kind: "operation",
      operation: "identity_connection_configure",
      connectionId: "conn-staff",
      request,
    },
  ]);
  expect(fixture.proofs).toEqual([
    {
      kind: "operation",
      operation: "identity_connection_configure",
      connectionId: "conn-staff",
      request,
      challengeId: "challenge-fixture",
      nonce: "n".repeat(43),
      method: "totp",
      code: "123456",
    },
  ]);
  expect(fixture.mutations).toEqual([
    {
      method: "PATCH",
      path: "/api/instance/identity-connections/conn-staff",
      token: "p".repeat(43),
      body: request,
    },
  ]);
  await expect(page.getByLabel("Authenticator code").first()).toHaveValue("");
  // The stored secret is never rendered and the URL carries no form state.
  expect(page.url()).toBe(
    `http://127.0.0.1:${new URL(page.url()).port}${LIST}/conn-staff`,
  );
});

test("a stale version keeps the draft, names the current version and reloads on request", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${LIST}/conn-staff`);
  await page.getByLabel("Connection name").fill("My edit");
  // Another administrator saves first.
  fixture.connections[0].configVersion = 9;
  fixture.connections[0].displayName = "Their edit";
  await enterVerification(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/now at version 9/u)).toBeVisible();
  await expect(page.getByLabel("Connection name")).toHaveValue("My edit");
  await expect(fixture.mutations).toHaveLength(1);

  await page.getByRole("button", { name: "Reload latest settings" }).click();
  await expect(page.getByLabel("Connection name")).toHaveValue("Their edit");
});

test("missing or rejected fresh verification changes nothing", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${LIST}/conn-staff`);
  await page.getByLabel("Connection name").fill("Renamed");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(
      "Enter the selected verification factor to confirm this change.",
    ),
  ).toBeVisible();
  expect(fixture.challenges).toHaveLength(0);

  fixture.stepUpChallengeStatus = 403;
  await enterVerification(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(/Fresh verification was unavailable/u),
  ).toBeVisible();
  expect(fixture.mutations).toHaveLength(0);
  await expect(page.getByLabel("Connection name")).toHaveValue("Renamed");
});

test("the API refusing the proof token after verification reports step-up and keeps the draft", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${LIST}/conn-staff`);
  await page.getByLabel("Connection name").fill("Renamed");
  fixture.nextMutation = {
    status: 403,
    body: "step_up_unavailable",
    text: true,
  };
  await enterVerification(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(/Fresh verification was unavailable/u),
  ).toBeVisible();
  await expect(page.getByLabel("Connection name")).toHaveValue("Renamed");
});

test("a server failure is reported without losing the draft", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(`${LIST}/conn-staff`);
  await page.getByLabel("Connection name").fill("Renamed");
  fixture.nextMutation = { status: 503, body: { message: "unavailable" } };
  await enterVerification(page);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/temporarily unavailable/u)).toBeVisible();
  await expect(page.getByLabel("Connection name")).toHaveValue("Renamed");
});

test("a non-administrator is denied the list and the editor", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  fixture.listStatus = 403;
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add Entra connection" }),
  ).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);
  await page.goto(`${LIST}/conn-staff`);
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(page.getByLabel("Connection name")).toHaveCount(0);
});

test("an unreadable stored configuration (503) shows an error with retry, then recovers", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  fixture.listStatus = 503;
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await expect(
    page.getByText(/stored identity configuration is invalid/u),
  ).toBeVisible({ timeout: 10_000 });
  fixture.listStatus = 200;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Staff Entra")).toBeVisible();
});

test("an empty instance shows the empty state with the add action", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  fixture.connections = [];
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await expect(page.getByText("No authentication providers")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Add Entra connection" }),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("creating a connection is disabled-by-default, staff-only and bound to the whole body @a11y", async ({
  page,
}) => {
  const fixture = newIdentityFixture();
  await installIdentityAdminFixture(page, fixture);
  await page.goto(LIST);
  await page.getByRole("link", { name: "Add Entra connection" }).click();
  await expect(page).toHaveURL(`${LIST}/new`);
  await expect(
    page.getByText("The new connection starts disabled."),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Connection enabled" }),
  ).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);

  await page
    .getByRole("button", { name: "Create disabled connection" })
    .click();
  await expect(page.getByText("Enter the tenant ID as a UUID.")).toBeVisible();
  expect(fixture.challenges).toHaveLength(0);

  await page.getByLabel("Connection name").fill("New staff connection");
  await page.getByLabel("Entra tenant ID").fill(TENANT_ID);
  await page.getByLabel("Application (client) ID").fill(CLIENT_ID);
  await page.getByLabel("Client secret").fill("fake-secret-placeholder");
  await page.getByLabel("Required Entra app role").fill("TaskDesk.User");
  await page.getByLabel("Maximum role rank").fill("10");
  await enterVerification(page);
  await page
    .getByRole("button", { name: "Create disabled connection" })
    .click();
  await expect(page).toHaveURL(`${LIST}/conn-created`);
  await expect(
    page.getByRole("heading", { name: "New staff connection", level: 1 }),
  ).toBeVisible();
  const challenge = fixture.challenges[0] as {
    operation: string;
    request: Record<string, unknown>;
  };
  expect(challenge.operation).toBe("identity_connection_create");
  expect(challenge.request).toMatchObject({
    portalScope: "agent",
    organisationId: null,
  });
  expect(fixture.mutations[0]?.body).toEqual(challenge.request);
});
