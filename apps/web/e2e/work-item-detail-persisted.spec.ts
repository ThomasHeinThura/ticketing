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

const OWNER = "Disposable Detail Owner";
const COLLEAGUE = "Detail Colleague";

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
        name: "Persisted Detail",
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

// Real API and disposable fixture database: success survives reload, and a stale holder
// precondition is refused by the server after a concurrent assignment.
test("detail state and assignee persist and a stale assignment is refused", async ({
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
    await page.getByLabel("Workspace name").fill("Persisted Detail Workspace");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    const project = await createProject(page, origin, databaseUrl);
    const csrf = await page.request.get(
      new URL("/api/me/csrf-token", origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(csrf.status()).toBe(200);
    const { token } = (await csrf.json()) as { token: string };
    const headers = {
      Origin: origin,
      "X-TaskDesk-CSRF": token,
      "content-type": "application/json",
    };
    const workspaces = await page.request.get(
      new URL("/api/workspace", origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(workspaces.status()).toBe(200);
    const [workspace] = (await workspaces.json()) as Array<{ id: string }>;
    if (!workspace) throw new Error("Missing workspace");
    const types = await page.request.get(
      new URL(
        `/api/workspace/${workspace.id}/work-item-types`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(types.status()).toBe(200);
    const [type] = (await types.json()) as Array<{ id: string }>;
    if (!type) throw new Error("Missing work item type");
    const created = await page.request.post(
      new URL(`/api/projects/${project.id}/work-items`, origin).toString(),
      { headers, data: { typeId: type.id, title: "Persisted detail journey" } },
    );
    expect(created.status()).toBe(200);
    const { key } = (await created.json()) as { key: string };
    const assignable = await page.request.get(
      new URL(`/api/projects/${project.id}/assignable`, origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(assignable.status()).toBe(200);
    const people = (await assignable.json()) as Array<{
      personId: string;
      name: string;
    }>;
    const owner = people.find((person) => person.name === OWNER);
    const colleague = people.find((person) => person.name === COLLEAGUE);
    if (!owner || !colleague)
      throw new Error("Owner and colleague must be assignable");
    const offersResponse = await page.request.get(
      new URL(`/api/work-items/${key}/transitions`, origin).toString(),
      { headers: { Origin: origin } },
    );
    expect(offersResponse.status()).toBe(200);
    const offers = (await offersResponse.json()) as Array<{
      toStateName: string;
      available: boolean;
      notePolicy: string;
    }>;
    const offer = offers.find(
      (entry) => entry.available && entry.notePolicy === "none",
    );
    if (!offer) throw new Error("No immediately available transition");
    await page.goto(new URL(`/agent/work-items/${key}`, origin).toString());
    const state = page.getByTestId("work-item-state-control");
    await state.click();
    const moved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/work-items/${key}/transition` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("menuitem", { name: new RegExp(offer.toStateName) })
      .click();
    expect((await moved).status()).toBe(200);
    await expect(state).toContainText(offer.toStateName);
    const assignee = page.getByTestId("work-item-assignee-control");
    await assignee.click();
    const assigned = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/work-items/${key}/assign` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: new RegExp(COLLEAGUE) }).click();
    expect((await assigned).status()).toBe(200);
    await expect(assignee).toContainText(COLLEAGUE);
    await page.reload();
    await expect(state).toContainText(offer.toStateName);
    await expect(assignee).toContainText(COLLEAGUE);

    // Hold the browser's genuine DELETE, then replace the holder through the real API.
    // Continuing the unchanged DELETE exercises the real stale-holder 409.
    let release!: () => void;
    let captured!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      captured = resolve;
    });
    const path = `**/api/work-items/${key}/assign*`;
    const detailPath = `**/api/work-items/${key}`;
    let releaseRefresh!: () => void;
    const refreshHeld = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route(detailPath, async (route) => {
      if (route.request().method() === "GET") await refreshHeld;
      await route.continue();
    });
    await page.route(path, async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      captured();
      await held;
      await route.continue();
    });
    try {
      await assignee.click();
      const refused = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/work-items/${key}/assign` &&
          response.request().method() === "DELETE",
      );
      await page
        .getByRole("button", { name: "Unassigned", exact: true })
        .click();
      await intercepted;
      await expect(assignee).toContainText("Unassigned");
      const concurrent = await page.request.post(
        new URL(`/api/work-items/${key}/assign`, origin).toString(),
        {
          headers,
          data: {
            assigneeId: owner.personId,
            expectedCurrentAssigneeId: colleague.personId,
          },
        },
      );
      expect(concurrent.status()).toBe(200);
      release();
      expect((await refused).status()).toBe(409);
      await expect(
        page.getByText(/The assignee changed in the meantime/),
      ).toBeVisible();
      await expect(assignee).toContainText(COLLEAGUE);
      releaseRefresh();
      await expect(assignee).toContainText(OWNER);
      await page.reload();
      await expect(assignee).toContainText(OWNER);
      await expect(state).toContainText(offer.toStateName);
    } finally {
      release();
      releaseRefresh();
      await page.unroute(path);
      await page.unroute(detailPath);
    }
  });
});
