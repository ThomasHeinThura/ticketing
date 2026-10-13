import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { withMfaCsrfApp } from "../../../tests/e2e/helpers/mfa-csrf-app-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });

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
  await page.goto(new URL("/auth/sign-up", origin).toString());
  await page.getByLabel("Full name").fill("Disposable Comments Admin");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="new-password"]').fill(password);
  const signUpPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  expect((await signUpPromise).status()).toBe(200);
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/);
  await page.getByLabel("Workspace name").fill("Disposable Comments Workspace");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard\/workspace\//);
}

async function signInThroughUi(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await page.goto("about:blank");
  const signOut = await page.request.post(
    new URL("/api/auth/sign-out", origin).toString(),
    { headers: { Origin: origin }, data: {} },
  );
  expect(signOut.status()).toBe(200);
  await page.goto(new URL("/auth/sign-in", origin).toString());
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\/|\?|$)/);
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
    const mentionRecipient = await seedReachableMentionRecipient(
      databaseUrl,
      item.workspaceId,
      item.projectId,
      email,
    );
    const itemUrl = new URL(
      `/agent/work-items/${encodeURIComponent(item.key)}`,
      origin,
    ).toString();
    await page.goto(itemUrl);

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
      await page.getByLabel("Filter activity").click();
      await page
        .getByRole("option", { name: "Public only", exact: true })
        .click();
      await expect(page).toHaveURL(/activity=public/);
      await expect(
        activity.locator('li[data-visibility="internal"]'),
      ).toHaveCount(0);
      await page.reload();
      await expect(page.getByLabel("Filter activity")).toContainText(
        "Public only",
      );
      await expect(commentRow).toBeVisible();
    });
  });
});
