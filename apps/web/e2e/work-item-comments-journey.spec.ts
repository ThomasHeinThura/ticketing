import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  type Locator,
  type Page,
  type Request,
  test,
} from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";
import { redactSecretErrorContext } from "./helpers/redact-secret-error-context";

test.use({ trace: "off", video: "off", screenshot: "off" });

test.afterEach(({ browserName: _browserName }, testInfo) => {
  redactSecretErrorContext(testInfo);
});

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

type WorkItemSetup = {
  key: string;
  id: string;
  projectId: string;
  workspaceId: string;
};

async function createAdminWorkspace(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await test.step("Setup diagnostic: sign-up page navigation", async () => {
    console.info("Setup diagnostic begin: sign-up page navigation");
    await page.goto(new URL("/auth/sign-up", origin).toString());
    console.info("Setup diagnostic completed: sign-up page navigation");
  });
  await test.step("Setup diagnostic: full-name field entry", async () => {
    console.info("Setup diagnostic begin: full-name field entry");
    await page.getByLabel("Full name").fill("Disposable Comments Admin");
    console.info("Setup diagnostic completed: full-name field entry");
  });
  await test.step("Setup diagnostic: sign-up email field entry", async () => {
    console.info("Setup diagnostic begin: sign-up email field entry");
    await page.getByLabel("Email").fill(email);
    console.info("Setup diagnostic completed: sign-up email field entry");
  });
  await test.step("Setup diagnostic: sign-up password field entry", async () => {
    console.info("Setup diagnostic begin: sign-up password field entry");
    await page.locator('input[autocomplete="new-password"]').fill(password);
    console.info("Setup diagnostic completed: sign-up password field entry");
  });
  const signUpListener =
    await test.step("Setup diagnostic: sign-up response listener registration", async () => {
      console.info(
        "Setup diagnostic begin: sign-up response listener registration",
      );
      const pendingResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
          response.request().method() === "POST",
      );
      console.info(
        "Setup diagnostic completed: sign-up response listener registration",
      );
      return { pendingResponse };
    });
  await test.step("Setup diagnostic: create-account button click", async () => {
    console.info("Setup diagnostic begin: create-account button click");
    await page.getByRole("button", { name: "Create account" }).click();
    console.info("Setup diagnostic completed: create-account button click");
  });
  const signUpResponse =
    await test.step("Setup diagnostic: sign-up response wait", async () => {
      console.info("Setup diagnostic begin: sign-up response wait");
      const response = await signUpListener.pendingResponse;
      console.info("Setup diagnostic completed: sign-up response wait");
      return response;
    });
  await test.step("Setup diagnostic: sign-up response status assertion", async () => {
    console.info("Setup diagnostic begin: sign-up response status assertion");
    expect(signUpResponse.status()).toBe(200);
    console.info(
      "Setup diagnostic completed: sign-up response status assertion",
    );
  });
  await test.step("Setup diagnostic: onboarding navigation assertion", async () => {
    console.info("Setup diagnostic begin: onboarding navigation assertion");
    await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
    console.info("Setup diagnostic completed: onboarding navigation assertion");
  });
  await test.step("Setup diagnostic: workspace-name field entry", async () => {
    console.info("Setup diagnostic begin: workspace-name field entry");
    await page
      .getByLabel("Workspace name")
      .fill("Disposable Comments Workspace");
    console.info("Setup diagnostic completed: workspace-name field entry");
  });
  await test.step("Setup diagnostic: create-workspace button click", async () => {
    console.info("Setup diagnostic begin: create-workspace button click");
    await page.getByRole("button", { name: "Create workspace" }).click();
    console.info("Setup diagnostic completed: create-workspace button click");
  });
  await test.step("Setup diagnostic: workspace-dashboard navigation assertion", async () => {
    console.info(
      "Setup diagnostic begin: workspace-dashboard navigation assertion",
    );
    await expect(page).toHaveURL(/\/dashboard\/workspace\//);
    console.info(
      "Setup diagnostic completed: workspace-dashboard navigation assertion",
    );
  });
}

async function signInThroughUi(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await test.step("Setup diagnostic: blank-page navigation", async () => {
    console.info("Setup diagnostic begin: blank-page navigation");
    await page.goto("about:blank");
    console.info("Setup diagnostic completed: blank-page navigation");
  });
  const signOut =
    await test.step("Setup diagnostic: sign-out request", async () => {
      console.info("Setup diagnostic begin: sign-out request");
      const response = await page.request.post(
        new URL("/api/auth/sign-out", origin).toString(),
        { headers: { Origin: origin }, data: {} },
      );
      console.info("Setup diagnostic completed: sign-out request");
      return response;
    });
  await test.step("Setup diagnostic: sign-out response status assertion", async () => {
    console.info("Setup diagnostic begin: sign-out response status assertion");
    expect(signOut.status()).toBe(200);
    console.info(
      "Setup diagnostic completed: sign-out response status assertion",
    );
  });
  await test.step("Setup diagnostic: sign-in page navigation", async () => {
    console.info("Setup diagnostic begin: sign-in page navigation");
    await page.goto(new URL("/auth/sign-in", origin).toString());
    console.info("Setup diagnostic completed: sign-in page navigation");
  });
  await test.step("Setup diagnostic: sign-in email field entry", async () => {
    console.info("Setup diagnostic begin: sign-in email field entry");
    await page.getByLabel("Email").fill(email);
    console.info("Setup diagnostic completed: sign-in email field entry");
  });
  await test.step("Setup diagnostic: sign-in password field entry", async () => {
    console.info("Setup diagnostic begin: sign-in password field entry");
    await page.locator('input[autocomplete="current-password"]').fill(password);
    console.info("Setup diagnostic completed: sign-in password field entry");
  });
  await test.step("Setup diagnostic: sign-in button click", async () => {
    console.info("Setup diagnostic begin: sign-in button click");
    await page.getByRole("button", { name: "Sign in" }).click();
    console.info("Setup diagnostic completed: sign-in button click");
  });
  await test.step("Setup diagnostic: dashboard navigation assertion", async () => {
    console.info("Setup diagnostic begin: dashboard navigation assertion");
    await expect(page).toHaveURL(/\/(?:dashboard|agent)(?:\/|\?|$)/);
    console.info("Setup diagnostic completed: dashboard navigation assertion");
  });
}

async function csrfHeaders(page: Page, origin: string) {
  const response = await page.request.get(
    new URL("/api/me/csrf-token", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { token?: string };
  expect(body.token).toBeTruthy();
  return {
    Origin: origin,
    "x-taskdesk-csrf": body.token ?? "",
    "content-type": "application/json",
  };
}

async function setupWorkItem(
  page: Page,
  origin: string,
): Promise<WorkItemSetup> {
  const headers = await csrfHeaders(page, origin);
  const workspacesResponse = await page.request.get(
    new URL("/api/workspace", origin).toString(),
    { headers: { Origin: origin } },
  );
  expect(workspacesResponse.status()).toBe(200);
  const workspaces = (await workspacesResponse.json()) as Array<{
    id: string;
    role: string;
  }>;
  const workspace = workspaces[0];
  expect(workspace?.role).toBe("owner");
  expect(workspace?.id).toBeTruthy();

  const typesResponse = await page.request.get(
    new URL(
      `/api/workspace/${encodeURIComponent(workspace?.id ?? "")}/work-item-types`,
      origin,
    ).toString(),
    { headers: { Origin: origin } },
  );
  expect(typesResponse.status()).toBe(200);
  const types = (await typesResponse.json()) as Array<{ id: string }>;
  const type = types[0];
  expect(type?.id).toBeTruthy();

  const projectResponse = await page.request.post(
    new URL("/api/project", origin).toString(),
    {
      headers,
      data: {
        name: "Comments E2E project",
        icon: "Folder",
        slug: `comments-e2e-${randomUUID().slice(0, 12)}`,
        workspaceId: workspace?.id,
      },
    },
  );
  const projectText = await projectResponse.text();
  expect(projectResponse.status(), projectText).toBe(200);
  const project = JSON.parse(projectText) as { id: string };
  expect(project.id).toBeTruthy();

  const itemResponse = await page.request.post(
    new URL(
      `/api/projects/${encodeURIComponent(project.id)}/work-items`,
      origin,
    ).toString(),
    {
      headers,
      data: { typeId: type?.id, title: "Comments E2E work item" },
    },
  );
  const itemText = await itemResponse.text();
  expect(itemResponse.status(), itemText).toBe(200);
  const item = JSON.parse(itemText) as { id: string; key: string };
  expect(item.id).toBeTruthy();
  expect(item.key).toBeTruthy();
  return {
    ...item,
    projectId: project.id,
    workspaceId: workspace?.id ?? "",
  };
}

async function seedReachableMentionRecipient(
  databaseUrl: string,
  workspaceId: string,
  projectId: string,
  authorEmail: string,
) {
  // This raw SQL bypasses Drizzle's JavaScript-only `$defaultFn` values. Supply
  // every inserted text primary key for user/person/workspace_member/role/membership;
  // workspace_member.joined_at is also explicit because migration 0007 removed its
  // database default. Database-defaulted timestamps and role flags remain omitted.
  const userId = `comments-e2e-${randomUUID()}`;
  const personId = `comments-person-${randomUUID()}`;
  const workspaceMemberId = `comments-workspace-member-${randomUUID()}`;
  const roleId = `comments-role-${randomUUID()}`;
  const recipientMembershipId = `comments-recipient-membership-${randomUUID()}`;
  const authorRoleId = `comments-author-role-${randomUUID()}`;
  const authorMembershipId = `comments-author-membership-${randomUUID()}`;
  const recipientName = "Comments Mention Recipient";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const organisation = await client.query<{ organisation_id: string }>(
      "SELECT organisation_id FROM workspace WHERE id = $1",
      [workspaceId],
    );
    expect(organisation.rowCount).toBe(1);
    const organisationId = organisation.rows[0]?.organisation_id;
    expect(organisationId).toBeTruthy();
    const author = await client.query<{ user_id: string; person_id: string }>(
      `SELECT u.id AS user_id, p.id AS person_id
         FROM "user" AS u
         JOIN person AS p ON p.user_id = u.id
        WHERE u.email = $1 AND p.side = 'staff' AND p.active = true`,
      [authorEmail],
    );
    expect(author.rowCount).toBe(1);
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, true)',
      [userId, recipientName, `${userId}@example.test`],
    );
    await client.query(
      "INSERT INTO person (id, user_id, organisation_id, side, display_name) VALUES ($1, $2, $3, 'staff', $4)",
      [personId, userId, organisationId, recipientName],
    );
    await client.query(
      "INSERT INTO workspace_member (id, workspace_id, user_id, role, joined_at) VALUES ($1, $2, $3, 'member', now())",
      [workspaceMemberId, workspaceId, userId],
    );
    await client.query(
      "INSERT INTO role (id, scope, workspace_id, key, name, rank, capabilities) VALUES ($1, 'project', $2, $3, $4, 1, $5::jsonb)",
      [
        roleId,
        workspaceId,
        roleId,
        recipientName,
        JSON.stringify(["project:read", "work_item:read"]),
      ],
    );
    await client.query(
      "INSERT INTO membership (id, person_id, scope, scope_id, role_id) VALUES ($1, $2, 'project', $3, $4)",
      [recipientMembershipId, personId, projectId, roleId],
    );
    await client.query(
      "INSERT INTO role (id, scope, workspace_id, key, name, rank, capabilities) VALUES ($1, 'project', $2, $3, $4, 1, $5::jsonb)",
      [
        authorRoleId,
        workspaceId,
        authorRoleId,
        "Comments E2E Author",
        JSON.stringify([
          "project:read",
          "work_item:read",
          "comment:create",
          "comment:create_internal",
          "comment:update_own",
        ]),
      ],
    );
    await client.query(
      "INSERT INTO membership (id, person_id, scope, scope_id, role_id) VALUES ($1, $2, 'project', $3, $4)",
      [authorMembershipId, author.rows[0]?.person_id, projectId, authorRoleId],
    );
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  return { personId, recipientName };
}

function commentEditor(activity: Locator) {
  return activity.locator(
    ".taskdesk-comment-editor-content [contenteditable='true']",
  );
}

test("real Comments UI posts, edits, pages history, and preserves scoped mentions", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);

  await withMfaCsrfApp(async ({ origin, email, password, databaseUrl }) => {
    await test.step("register and sign in through the actual UI", async () => {
      await createAdminWorkspace(page, origin, email, password);
      await signInThroughUi(page, origin, email, password);
    });

    const item = await test.step("prepare a reachable work item", () =>
      setupWorkItem(page, origin));
    const itemUrl = new URL(
      `/agent/work-items/${encodeURIComponent(item.key)}`,
      origin,
    ).toString();
    await page.goto(itemUrl);

    await test.step("persist inline title and description edits through the real API", async () => {
      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await expect(title).toHaveValue("Comments E2E work item");
      const titleSaved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/work-items/${item.key}` &&
          response.request().method() === "PATCH",
      );
      await title.fill("Inline edited work item");
      await title.press("Tab");
      const response = await titleSaved;
      expect(response.status(), await response.text()).toBe(200);
      expect(response.request().headers()["if-match"]).toMatch(/^"\d+"$/);
      const description = page.getByRole("region", {
        name: "Description",
        exact: true,
      });
      await expect(
        description.getByRole("button", { name: "Attach file" }),
      ).toHaveCount(0);
      const editor = description.locator('[contenteditable="true"]');
      const descriptionSaved = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname === `/api/work-items/${item.key}` &&
          answer.request().method() === "PATCH",
      );
      await editor.fill("A persisted rich-text description");
      await title.focus();
      expect((await descriptionSaved).status()).toBe(200);
      await page.reload();
      await expect(title).toHaveValue("Inline edited work item");
      await expect(
        page.getByRole("region", { name: "Description", exact: true }),
      ).toContainText("A persisted rich-text description");
    });

    await test.step("persist catalogue labels through the Kaneo properties picker", async () => {
      const response = await page.request.post(
        new URL("/api/label", origin).toString(),
        {
          headers: await csrfHeaders(page, origin),
          data: {
            workspaceId: item.workspaceId,
            name: "SIT label",
            color: "teal",
          },
        },
      );
      expect(response.status(), await response.text()).toBe(200);
      await page.reload();
      const trigger = page.getByRole("button", { name: "Labels", exact: true });
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const saved = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname === `/api/work-items/${item.key}` &&
          answer.request().method() === "PATCH",
      );
      await page
        .getByRole("checkbox", { name: "SIT label Workspace", exact: true })
        .click();
      expect((await saved).status()).toBe(200);
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(trigger).toContainText("SIT label");
      await page.screenshot({
        path: testInfo.outputPath("kaneo-canonical-labels.png"),
        fullPage: true,
      });
    });

    await test.step("manage and assign a project catalogue through real Kaneo settings", async () => {
      const settingsUrl = new URL(
        `/dashboard/settings/projects/${encodeURIComponent(item.projectId)}/labels`,
        origin,
      ).toString();
      await page.goto(settingsUrl);
      await expect(
        page.getByRole("heading", { name: "Labels", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Create Label", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: /^(Create|Edit) Label$/,
      });
      await dialog.getByLabel("Label name").fill("SIT project label");
      const created = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname ===
            `/api/label/project/${item.projectId}/catalogue` &&
          answer.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "Create Label", exact: true })
        .click();
      const response = await created;
      expect(response.status(), await response.text()).toBe(200);
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await expect(
        page.getByText("SIT project label", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("kaneo-project-label-settings.png"),
        fullPage: true,
      });
      await page.goto(itemUrl);
      const trigger = page.getByRole("button", { name: "Labels", exact: true });
      await trigger.click();
      const assigned = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname === `/api/work-items/${item.key}` &&
          answer.request().method() === "PATCH",
      );
      await page
        .getByRole("checkbox", {
          name: "SIT project label Project",
          exact: true,
        })
        .click();
      expect((await assigned).status()).toBe(200);
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(trigger).toContainText("SIT project label");
      await expect(trigger).toContainText("SIT label");
      await page.goto(settingsUrl);
      await page
        .getByRole("button", { name: "Edit Label", exact: true })
        .click();
      await dialog.getByLabel("Label name").fill("Renamed project label");
      const renamed = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname.startsWith(
            `/api/label/project/${item.projectId}/catalogue/`,
          ) && answer.request().method() === "PATCH",
      );
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      expect((await renamed).status()).toBe(200);
      await expect(dialog).not.toBeVisible();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      const deleted = page.waitForResponse(
        (answer) =>
          new URL(answer.url()).pathname.startsWith(
            `/api/label/project/${item.projectId}/catalogue/`,
          ) && answer.request().method() === "DELETE",
      );
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      expect((await deleted).status()).toBe(200);
      await expect(page.getByRole("alertdialog")).not.toBeVisible();
      await page.goto(itemUrl);
      await expect(trigger).toContainText("SIT label");
      await expect(trigger).not.toContainText("project label");
      await trigger.click();
      await expect(
        page.getByRole("checkbox", {
          name: "Renamed project label Project",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
    });

    await test.step("page a persisted hierarchy through the canonical Kaneo surface", async () => {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let childKeys: string[];
      try {
        // Disposable database fixture only: clone authoritative project/type/state
        // from the actual API-created parent, with 51 real direct children.
        const children = await client.query<{ key: string }>(
          `INSERT INTO work_item
             (id, workspace_id, project_id, type_id, number, key, title,
              parent_id, state_id, position)
           SELECT $1 || '-' || n, parent.workspace_id, parent.project_id,
                  parent.type_id, 1000 + n, project.slug || '-' || (1000 + n),
                  'Persisted hierarchy child ' || n, parent.id, parent.state_id, n
             FROM work_item AS parent
             JOIN project ON project.id = parent.project_id
             CROSS JOIN generate_series(1, 51) AS n
            WHERE parent.id = $2
           RETURNING key`,
          [`hierarchy-${randomUUID()}`, item.id],
        );
        expect(children.rowCount).toBe(51);
        childKeys = children.rows.map((row) => row.key);
      } finally {
        await client.end();
      }
      await page.goto(itemUrl);
      const hierarchy = page.getByTestId("work-item-hierarchy");
      await expect(hierarchy.getByText("0/51", { exact: true })).toBeVisible();
      await expect(hierarchy.getByRole("link")).toHaveCount(51);
      const more = hierarchy.getByRole("button", {
        name: `Load more children of ${item.key}`,
        exact: true,
      });
      const nextPage = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === `/api/work-items/${item.key}/children` &&
          url.searchParams.has("cursor")
        );
      });
      await more.click();
      const response = await nextPage;
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.data).toHaveLength(1);
      expect(payload.meta.total).toBe(51);
      await expect(hierarchy.getByRole("link")).toHaveCount(52);
      await expect(more).toHaveCount(0);
      await page.reload();
      await expect(hierarchy.getByRole("link")).toHaveCount(52, {
        timeout: 15000,
      });
      await hierarchy
        .getByRole("link", {
          name: `${childKeys[0]} · Persisted hierarchy child 1`,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/agent/work-items/${childKeys[0]}$`),
      );
      await expect(hierarchy.locator('[aria-current="page"]')).toContainText(
        childKeys[0] ?? "",
      );
      await expect(
        hierarchy.getByRole("link", {
          name: `${item.key} · Inline edited work item`,
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("kaneo-hierarchy-real-api.png"),
        fullPage: true,
      });
      await page.goto(itemUrl);
    });

    const mentionRecipient = await seedReachableMentionRecipient(
      databaseUrl,
      item.workspaceId,
      item.projectId,
      email,
    );
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(
      page
        .getByRole("region", { name: "Description", exact: true })
        .locator('[contenteditable="true"]'),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: "Labels", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Labels", exact: true }),
    ).toContainText("SIT label");

    const activity = page.getByTestId("work-item-activity");
    await expect(activity).toBeVisible();
    const visibility = page.locator("#comment-visibility");
    await expect(visibility).toContainText("Internal");
    const composer = commentEditor(activity);
    await expect(composer).toBeVisible();

    await test.step("recover the internal draft after opening a fresh tab", async () => {
      await composer.fill("Recovered internal draft");
      const recoveryPage = await page.context().newPage();
      try {
        await recoveryPage.goto(itemUrl);
        const recoveredActivity =
          recoveryPage.getByTestId("work-item-activity");
        const recoveredEditor = commentEditor(recoveredActivity);
        await expect(recoveredEditor).toHaveText("Recovered internal draft");
        await expect(recoveryPage.locator("#comment-visibility")).toContainText(
          "Internal",
        );
        await recoveryPage.screenshot({
          path: testInfo.outputPath("comments-draft-recovery.png"),
          fullPage: true,
        });
      } finally {
        await recoveryPage.close();
      }
    });

    const internalSubmit = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/work-items/${item.key}/comments` &&
        response.request().method() === "POST",
    );
    await activity.getByRole("button", { name: "Send comment" }).click();
    const internalResponse = await internalSubmit;
    expect(internalResponse.status()).toBe(200);
    expect(internalResponse.request().headers()["content-type"]).toMatch(
      /^application\/json(?:;|$)/iu,
    );
    expect(internalResponse.headers()["content-type"]).toMatch(
      /^application\/json(?:;|$)/iu,
    );
    const internalComment = (await internalResponse.json()) as {
      id: string;
      visibility: string;
      body: { type: string };
    };
    expect(internalComment.id).toBeTruthy();
    expect(internalComment.visibility).toBe("internal");
    expect(internalComment.body.type).toBe("doc");
    expect(JSON.stringify(internalComment.body)).toContain(
      "Recovered internal draft",
    );
    await expect(
      activity.locator('li[data-visibility="internal"]').filter({
        hasText: "Recovered internal draft",
      }),
    ).toBeVisible();

    await test.step("reject an oversized JSON comment with the API contract", async () => {
      const headers = await csrfHeaders(page, origin);
      const response = await page.request.post(
        new URL(`/api/work-items/${item.key}/comments`, origin).toString(),
        {
          headers,
          data: {
            body: {
              type: "doc",
              content: [{ type: "text", text: "x".repeat(300 * 1024) }],
            },
            visibility: "public",
          },
        },
      );
      expect(response.status()).toBe(400);
      expect(await response.text()).toContain("body must not exceed");
    });

    await visibility.click();
    await page.getByRole("option", { name: "Public", exact: true }).click();
    await expect(visibility).toContainText("Public");
    const mentionCandidatesResponse = await page.request.get(
      new URL(
        `/api/work-items/${encodeURIComponent(item.key)}/comments/mention-candidates?visibility=public`,
        origin,
      ).toString(),
      { headers: { Origin: origin } },
    );
    expect(mentionCandidatesResponse.status()).toBe(200);
    expect(mentionCandidatesResponse.headers()["content-type"]).toMatch(
      /^application\/json(?:;|$)/iu,
    );
    const mentionCandidates =
      (await mentionCandidatesResponse.json()) as Array<{
        personId: string;
        name: string;
        reachable: boolean;
      }>;
    expect(Array.isArray(mentionCandidates)).toBe(true);
    expect(
      mentionCandidates.some(
        (candidate) =>
          candidate.personId === mentionRecipient.personId &&
          candidate.name === mentionRecipient.recipientName &&
          candidate.reachable,
      ),
    ).toBe(true);
    await composer.click();
    await composer.pressSequentially("@Comments");
    const mentionButton = page
      .locator(".taskdesk-mention-list")
      .getByRole("button", {
        name: mentionRecipient.recipientName,
        exact: true,
      });
    await expect(mentionButton).toBeVisible();
    await mentionButton.click();
    await composer.pressSequentially(" saw the update");

    const publicSubmit = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/work-items/${item.key}/comments` &&
        response.request().method() === "POST",
    );
    await activity.getByRole("button", { name: "Send comment" }).click();
    const publicResponse = await publicSubmit;
    expect(publicResponse.status()).toBe(200);
    expect(publicResponse.request().headers()["content-type"]).toMatch(
      /^application\/json(?:;|$)/iu,
    );
    expect(publicResponse.headers()["content-type"]).toMatch(
      /^application\/json(?:;|$)/iu,
    );
    const publicComment = (await publicResponse.json()) as {
      id: string;
      visibility: string;
      body: {
        content?: Array<{
          content?: Array<{
            type?: string;
            text?: string;
            attrs?: { id?: string };
          }>;
        }>;
      };
    };
    expect(publicComment.id).toBeTruthy();
    expect(publicComment.visibility).toBe("public");
    expect(
      publicComment.body.content?.flatMap(
        (paragraph) => paragraph.content ?? [],
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "taskdeskMention",
        attrs: expect.objectContaining({ id: mentionRecipient.personId }),
      }),
    );
    expect(
      publicComment.body.content
        ?.flatMap((paragraph) => paragraph.content ?? [])
        .some((node) => node.text?.includes("saw the update")),
    ).toBe(true);

    const historyDb = new Client({ connectionString: databaseUrl });
    await historyDb.connect();
    try {
      const persistedComments = await historyDb.query<{
        id: string;
        body: { type: string } | null;
        visibility: string;
      }>(
        `SELECT id, body, visibility FROM comment
          WHERE work_item_id = $1 AND id = ANY($2::text[])`,
        [item.id, [internalComment.id, publicComment.id]],
      );
      const persistedById = new Map(
        persistedComments.rows.map((comment) => [comment.id, comment]),
      );
      expect(persistedById.size).toBe(2);
      expect(persistedById.get(internalComment.id)).toMatchObject({
        body: internalComment.body,
        visibility: internalComment.visibility,
      });
      expect(persistedById.get(publicComment.id)).toMatchObject({
        body: publicComment.body,
        visibility: publicComment.visibility,
      });
      const persisted = await historyDb.query<{
        notification_count: string;
        delivery_count: string;
      }>(
        `SELECT
           (SELECT count(*) FROM notification
             WHERE kind = 'work_item.mentioned' AND resource_id = $1
               AND person_id = $2) AS notification_count,
           (SELECT count(*) FROM notification_delivery
             WHERE recipient_person_id = $2 AND event_id IN
               (SELECT event_id FROM notification
                 WHERE kind = 'work_item.mentioned' AND resource_id = $1
                   AND person_id = $2)) AS delivery_count`,
        [publicComment.id, mentionRecipient.personId],
      );
      expect(persisted.rows[0]).toEqual({
        notification_count: "1",
        delivery_count: "0",
      });
    } finally {
      await historyDb.end();
    }

    const commentRow = activity.locator("ol > li").last();
    await expect(commentRow).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("comments-public-and-internal.png"),
      fullPage: true,
    });

    await test.step("edit through the UI and page bounded history", async () => {
      for (let revision = 1; revision <= 6; revision += 1) {
        await commentRow
          .getByRole("button", { name: "Edit", exact: true })
          .click();
        const editor = commentRow.locator(
          ".taskdesk-comment-editor-content [contenteditable='true']",
        );
        await editor.fill(`Comments revision ${revision}`);
        const save = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname ===
              `/api/comments/${publicComment.id}` &&
            response.request().method() === "PATCH",
        );
        await commentRow.getByRole("button", { name: "Save changes" }).click();
        expect((await save).status()).toBe(200);
        await expect(commentRow).toContainText(`Comments revision ${revision}`);
      }

      const historyFirstPage = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/work-items/${item.key}/comments/${publicComment.id}/versions` &&
          response.request().method() === "GET",
      );
      // Accessible name is "Edited — Comment history": it starts with the visible text.
      await commentRow
        .getByRole("button", { name: "Edited — Comment history", exact: true })
        .click();
      const firstResponse = await historyFirstPage;
      expect(new URL(firstResponse.url()).searchParams.get("limit")).toBe("5");
      const firstPage = (await firstResponse.json()) as {
        data: unknown[];
        page: { hasMore: boolean; nextCursor: string | null };
      };
      expect(firstPage.data).toHaveLength(5);
      expect(firstPage.page.hasMore).toBe(true);
      expect(firstPage.page.nextCursor).toBeTruthy();
      await expect(
        page
          .getByRole("list", { name: "Comment history" })
          .getByRole("listitem"),
      ).toHaveCount(5);

      const historySecondPage = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/work-items/${item.key}/comments/${publicComment.id}/versions` &&
          response.request().method() === "GET" &&
          new URL(response.url()).searchParams.has("cursor"),
      );
      await page.getByRole("button", { name: "Load more versions" }).click();
      const secondResponse = await historySecondPage;
      expect(new URL(secondResponse.url()).searchParams.get("limit")).toBe("5");
      expect(
        ((await secondResponse.json()) as { data: unknown[] }).data,
      ).toHaveLength(1);
      await expect(
        page
          .getByRole("list", { name: "Comment history" })
          .getByRole("listitem"),
      ).toHaveCount(6);
      await page.keyboard.press("Escape");

      const headers = await csrfHeaders(page, origin);
      const ten = await page.request.get(
        new URL(
          `/api/work-items/${item.key}/comments/${publicComment.id}/versions?limit=10`,
          origin,
        ).toString(),
        { headers: { Origin: origin } },
      );
      expect(ten.status()).toBe(200);
      expect(((await ten.json()) as { data: unknown[] }).data).toHaveLength(6);
      const eleven = await page.request.get(
        new URL(
          `/api/work-items/${item.key}/comments/${publicComment.id}/versions?limit=11`,
          origin,
        ).toString(),
        { headers },
      );
      expect(eleven.status()).toBe(400);
    });

    await test.step("filter state is URL-backed and survives reload", async () => {
      await page.getByRole("combobox", { name: "Filter activity" }).click();
      await page
        .getByRole("option", { name: "Public only", exact: true })
        .click();
      await expect(page).toHaveURL(/activity=public/);
      await expect(
        activity.locator('li[data-visibility="internal"]'),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole("combobox", { name: "Filter activity" }),
      ).toContainText("Public only");
      await expect(commentRow).toBeVisible();
    });
  });
});

test("CA-19/20 inserts an item-scoped canned response as an editable comment draft", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });

  await withMfaCsrfApp(async ({ origin, email, password, fixtureDir }) => {
    await test.step("CA19 phase: workspace setup and sign-in", async () => {
      console.info("CA19 phase begin: workspace setup and sign-in");
      await createAdminWorkspace(page, origin, email, password);
      await signInThroughUi(page, origin, email, password);
      console.info("CA19 phase completed: workspace setup and sign-in");
    });
    const item = await test.step("CA19 phase: work-item setup", async () => {
      console.info("CA19 phase begin: work-item setup");
      const result = await setupWorkItem(page, origin);
      console.info("CA19 phase completed: work-item setup");
      return result;
    });

    const responseName = "CA-19 composer response";
    const templateText =
      "Thanks for reporting this. {{work_item.key}} is under review. Due {{work_item.due_date}}.";
    const originalText = `Thanks for reporting this. ${item.key} is under review. Due 2026-10-25.`;
    const editedText = `${originalText} We will follow up shortly.`;
    const created =
      await test.step("CA19 phase: create a canned response through workspace settings", async () => {
        await page.goto(
          new URL("/agent/settings/canned-responses", origin).toString(),
        );
        await page
          .getByRole("button", { name: "New response", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name", { exact: true }).fill(responseName);
        await dialog
          .locator(".ProseMirror[contenteditable=true]")
          .fill(templateText);
        const saved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/canned-responses" &&
            response.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        const response = await saved;
        const captured = {
          status: response.status(),
          text: await response.text(),
        };
        expect(captured.status, captured.text).toBe(200);
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("button", {
            name: `Edit ${responseName}`,
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/kaneo-canned-response-real-library.png",
        });
        return captured;
      });
    const cannedResponse =
      await test.step("CA19 phase: validate canned-response API create", async () => {
        console.info("CA19 phase begin: validate canned-response API create");
        const createdText = created.text;
        expect(created.status, createdText).toBe(200);
        const result = JSON.parse(createdText) as { id: string; body: unknown };
        expect(result.id).toBeTruthy();
        expect(JSON.stringify(result.body)).toContain("{{work_item.key}}");
        console.info(
          "CA19 phase completed: validate canned-response API create",
        );
        return result;
      });

    const itemUrl = new URL(
      `/agent/work-items/${encodeURIComponent(item.key)}`,
      origin,
    ).toString();
    const cannedListRequest = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.origin === origin &&
        url.pathname === "/api/canned-responses" &&
        response.request().method() === "GET"
      );
    });
    const activity = page.getByTestId("work-item-activity");
    const composer = commentEditor(activity);
    await test.step("CA19 phase: item navigation and scoped snippet fetch", async () => {
      console.info(
        "CA19 phase begin: item navigation and scoped snippet fetch",
      );
      await page.goto(itemUrl);
      await expect(activity).toBeVisible();
      await expect(composer).toBeVisible();
      const listResponse = await cannedListRequest;
      expect(new URL(listResponse.url()).searchParams.get("workItemKey")).toBe(
        item.key,
      );
      expect(listResponse.status()).toBe(200);
      const listedResponses = (await listResponse.json()) as Array<{
        id: string;
        name: string;
        body: unknown;
        visibilityDefault: string;
      }>;
      expect(listedResponses).toContainEqual(
        expect.objectContaining({
          id: cannedResponse.id,
          name: responseName,
          body: expect.objectContaining({ type: "doc" }),
          visibilityDefault: "internal",
        }),
      );
      console.info(
        "CA19 phase completed: item navigation and scoped snippet fetch",
      );
    });

    const commentPath = `/api/work-items/${encodeURIComponent(item.key)}/comments`;
    const commentPosts: Request[] = [];
    const recordCommentPost = (request: Request) => {
      if (
        new URL(request.url()).pathname === commentPath &&
        request.method() === "POST"
      ) {
        commentPosts.push(request);
      }
    };
    page.on("request", recordCommentPost);
    try {
      await test.step("CA19 phase: insert, edit, and verify no automatic send", async () => {
        console.info(
          "CA19 phase begin: insert, edit, and verify no automatic send",
        );
        // Keep this composer mounted and its initial snippet list cached. A change
        // by another actor must be reflected when the agent selects a template.
        const detailResponse = await page.request.get(
          new URL(`/api/work-items/${item.key}`, origin).toString(),
        );
        expect(detailResponse.status()).toBe(200);
        const detail = (await detailResponse.json()) as { version: number };
        const changedDueDate = await page.request.patch(
          new URL(`/api/work-items/${item.key}`, origin).toString(),
          {
            headers: {
              ...(await csrfHeaders(page, origin)),
              "if-match": `"${detail.version}"`,
            },
            data: { dueDate: "2026-10-25T00:00:00.000Z" },
          },
        );
        expect(changedDueDate.status(), await changedDueDate.text()).toBe(200);
        const responseSelect = page.getByRole("combobox", {
          name: "Canned response",
        });
        await expect(responseSelect).toBeVisible();
        await responseSelect.click();
        await page
          .getByRole("option", { name: responseName, exact: true })
          .click();
        await expect(composer).toContainText(originalText);
        await expect(page.locator("#comment-visibility")).toContainText(
          "Internal",
        );

        await composer.fill(editedText);
        await expect(composer).toContainText(editedText);
        expect(commentPosts).toHaveLength(0);

        const beforeSend = await page.request.get(
          new URL(
            `/api/work-items/${encodeURIComponent(item.key)}/activity`,
            origin,
          ).toString(),
          { headers: { Origin: origin } },
        );
        expect(beforeSend.status()).toBe(200);
        const beforeSendActivity = (await beforeSend.json()) as {
          data: Array<{ kind?: string; body?: unknown }>;
        };
        expect(
          beforeSendActivity.data.some(
            (row) =>
              row.kind === "comment" &&
              JSON.stringify(row.body).includes(originalText),
          ),
        ).toBe(false);

        const screenshotPath = resolve(
          fixtureDir,
          "canned-response-composer.png",
        );
        await activity.screenshot({ path: screenshotPath });
        console.info(
          "CA19 phase completed: insert, edit, and verify no automatic send",
        );
      });

      await test.step("CA19 phase: send and verify durable comment", async () => {
        console.info("CA19 phase begin: send and verify durable comment");
        const postedResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === commentPath &&
            response.request().method() === "POST",
        );
        await activity.getByRole("button", { name: "Send comment" }).click();
        const commentResponse = await postedResponse;
        expect(commentResponse.status()).toBe(200);
        const postedComment = (await commentResponse.json()) as {
          id: string;
          body: unknown;
          visibility: string;
        };
        expect(postedComment.id).toBeTruthy();
        expect(postedComment.visibility).toBe("internal");
        expect(JSON.stringify(postedComment.body)).toContain(editedText);
        expect(commentPosts).toHaveLength(1);

        const persistedResponse = await page.request.get(
          new URL(
            `/api/work-items/${encodeURIComponent(item.key)}/activity`,
            origin,
          ).toString(),
          { headers: { Origin: origin } },
        );
        expect(persistedResponse.status()).toBe(200);
        const persistedActivity = (await persistedResponse.json()) as {
          data: Array<{
            id: string;
            kind?: string;
            body?: unknown;
            visibility: string;
          }>;
        };
        expect(persistedActivity.data).toContainEqual(
          expect.objectContaining({
            id: postedComment.id,
            kind: "comment",
            body: postedComment.body,
            visibility: "internal",
          }),
        );
        expect(
          persistedActivity.data.filter(
            (row) =>
              row.kind === "comment" &&
              JSON.stringify(row.body).includes(originalText),
          ),
        ).toHaveLength(1);
        console.info("CA19 phase completed: send and verify durable comment");
      });
    } finally {
      page.off("request", recordCommentPost);
    }
  });
});
