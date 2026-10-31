import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { uniqueProjectKey } from "../../../tests/e2e/helpers/project-key";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });

// The fixture signs up with a disposable password; a failure snapshot would print it.
test.afterEach(({ page: _page }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

const OWNER = "Disposable Overview Owner";
const COLLEAGUE = "Overview Stakeholder";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(repoRoot, "apps/api/package.json"));
type FixturePgClient = {
  connect(): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: T[] }>;
  end(): Promise<void>;
};
const { Client } = apiRequire("pg") as {
  Client: new (options: { connectionString: string }) => FixturePgClient;
};

/**
 * A second staff member of the workspace, on the disposable database only. The owner cannot
 * put themself on a roster (cannot_grant_to_self), so the stakeholder is this colleague.
 */
async function seedColleague(databaseUrl: string, workspaceId: string) {
  const userId = `overview-e2e-${randomUUID()}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const organisation = await client.query<{ organisation_id: string }>(
      "SELECT organisation_id FROM workspace WHERE id = $1",
      [workspaceId],
    );
    expect(organisation.rowCount).toBe(1);
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)',
      [userId, COLLEAGUE, `${userId}@example.test`],
    );
    await client.query(
      "INSERT INTO person (id, user_id, organisation_id, side, display_name) VALUES ($1, $2, $3, 'staff', $4)",
      [
        `overview-person-${randomUUID()}`,
        userId,
        organisation.rows[0]?.organisation_id,
        COLLEAGUE,
      ],
    );
    await client.query(
      "INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, 'member', now())",
      [`overview-member-${randomUUID()}`, workspaceId, userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function createProject(page: Page, origin: string, databaseUrl: string) {
  const csrf = await page.request.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(csrf.status()).toBe(200);
  const { token } = (await csrf.json()) as { token: string };
  const workspaces = await page.request.get(
    new URL("/api/workspace", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(workspaces.status()).toBe(200);
  const [workspace] = (await workspaces.json()) as Array<{ id: string }>;
  if (!workspace) throw new Error("The new owner has no workspace.");
  await seedColleague(databaseUrl, workspace.id);
  const slug = uniqueProjectKey(6);
  const response = await page.request.post(
    new URL("/api/project", origin).toString(),
    {
      headers: {
        Origin: origin,
        "X-TaskDesk-CSRF": token,
        "content-type": "application/json",
      },
      data: {
        name: "Persisted Overview",
        icon: "Folder",
        slug,
        workspaceId: workspace.id,
      },
    },
  );
  const text = await response.text();
  expect(response.status(), text).toBe(200);
  const id = (JSON.parse(text) as { id: string }).id;

  // Team stakeholders are chosen from the roster: put the colleague on it.
  const candidates = await page.request.get(
    new URL(`/api/projects/${id}/members/candidates`, origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(candidates.status()).toBe(200);
  const colleague = (
    (await candidates.json()) as Array<{
      personId: string;
      displayName: string | null;
    }>
  ).find((candidate) => candidate.displayName === COLLEAGUE);
  if (!colleague) throw new Error("The colleague is not a roster candidate.");
  const added = await page.request.post(
    new URL(`/api/projects/${id}/members`, origin).toString(),
    {
      headers: {
        Origin: origin,
        "X-TaskDesk-CSRF": token,
        "content-type": "application/json",
      },
      data: { personId: colleague.personId, roleKey: "project-member" },
    },
  );
  expect(added.status(), await added.text()).toBe(200);
  return { slug, id };
}

// S3 against the real API and database: add a milestone, add and tick a prerequisite, and
// stand a stakeholder down (confirmed, never one click). Each change survives a reload.
test("Overview writes persist: milestone, prerequisite, stakeholder stand-down", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  await withMfaCsrfApp(async ({ origin, email, password, databaseUrl }) => {
    await page.goto(new URL("/auth/sign-up", origin).toString());
    await page.getByLabel("Full name").fill(OWNER);
    await page.getByLabel("Email").fill(email);
    await page.locator('input[autocomplete="new-password"]').fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
    await page
      .getByLabel("Workspace name")
      .fill("Persisted Overview Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    const project = await createProject(page, origin, databaseUrl);

    // Milestone, on the Overview.
    await page.goto(
      new URL(`/agent/projects/${project.slug}`, origin).toString(),
    );
    const milestones = page.getByTestId("project-milestones-panel");
    await milestones.getByRole("button", { name: "Add milestone" }).click();
    const milestoneDialog = page.getByRole("dialog", { name: "Add milestone" });
    await milestoneDialog.getByLabel("Name").fill("Go-live");
    await milestoneDialog
      .getByRole("button", { name: "Date", exact: true })
      .click();
    const dateEntry = page.getByLabel("Date (YYYY-MM-DD)");
    await dateEntry.fill("2099-05-01");
    await dateEntry.press("Enter");
    await milestoneDialog
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(milestoneDialog).toBeHidden();
    await expect(milestones).toContainText("Go-live");
    await page.reload();
    await expect(page.getByTestId("project-milestones-panel")).toContainText(
      "Go-live",
    );

    // Prerequisite: add, then tick.
    await page.goto(
      new URL(
        `/agent/projects/${project.slug}/prerequisites`,
        origin,
      ).toString(),
    );
    await page.getByRole("button", { name: "Add prerequisite" }).click();
    const prerequisiteDialog = page.getByRole("dialog", {
      name: "Add prerequisite",
    });
    await prerequisiteDialog.getByLabel("Title").fill("Customer VPN access");
    await prerequisiteDialog
      .getByRole("button", { name: "Add prerequisite" })
      .click();
    await expect(prerequisiteDialog).toBeHidden();
    await page
      .getByRole("checkbox", { name: 'Mark "Customer VPN access" done' })
      .click();
    await expect(
      page.getByRole("checkbox", {
        name: 'Mark "Customer VPN access" not done',
      }),
    ).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: 'Mark "Customer VPN access" not done',
      }),
    ).toBeChecked();
    await expect(page.getByText("0 outstanding of 1")).toBeVisible();

    // Stakeholder: add the colleague from the roster, then stand them down.
    await page.goto(
      new URL(`/agent/projects/${project.slug}/team`, origin).toString(),
    );
    await expect(page.getByTestId("project-roster")).toContainText(COLLEAGUE);
    await page.getByRole("button", { name: "Add stakeholder" }).click();
    const stakeholderDialog = page.getByRole("dialog", {
      name: "Add stakeholder",
    });
    await stakeholderDialog.getByLabel("Role").fill("Delivery lead");
    await stakeholderDialog
      .getByRole("button", { name: "Add stakeholder" })
      .click();
    await expect(stakeholderDialog).toBeHidden();
    const row = page
      .getByTestId("project-stakeholder-row")
      .filter({ hasText: COLLEAGUE });
    await expect(row).toContainText("Delivery lead");

    const openConfirm = async () => {
      await row
        .getByRole("button", { name: `Actions for ${COLLEAGUE}` })
        .click();
      await page.getByRole("menuitem", { name: "Stand down" }).click();
      const confirm = page.getByRole("alertdialog", {
        name: `Stand down ${COLLEAGUE}?`,
      });
      await expect(confirm).toBeVisible();
      return confirm;
    };
    const cancelled = await openConfirm();
    await cancelled.getByRole("button", { name: "Cancel" }).click();
    await expect(cancelled).toBeHidden();
    await page.reload();
    await expect(row).not.toContainText("Stood down");

    const confirm = await openConfirm();
    await confirm.getByTestId("project-stakeholder-stand-down-confirm").click();
    await expect(confirm).toBeHidden();
    await expect(row).toContainText("Stood down");
    await page.reload();
    await expect(row).toContainText("Stood down");
    await expect(
      row.getByRole("button", { name: `Actions for ${COLLEAGUE}` }),
    ).toHaveCount(0);
  });
});
