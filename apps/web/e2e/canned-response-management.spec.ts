import { expect, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
  WORK_ITEM_KEY,
} from "./helpers/g11-performance-fixture";

const PATH = "/dashboard/settings/workspace/canned-responses";
test("workspace settings creates, edits and deletes reusable replies with URL-addressed dialogs", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      json: {
        manageWorkspaceSettings: true,
        manageRoles: true,
        manageWebhooks: true,
        manageCustomFields: true,
      },
    }),
  );
  let rows: Array<{
    id: string;
    name: string;
    body: unknown;
    visibilityDefault: string;
  }> = [];
  const deletions: string[] = [];
  let requested = 0;
  let pendingId = "";
  let pendingState = "pending";
  let approvals = 0;
  let cancels = 0;
  await page.route("**/api/canned-responses**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: rows });
    if (request.method() === "POST") {
      rows.push({ id: "snippet-1", ...request.postDataJSON() });
      return route.fulfill({ json: rows[0] });
    }
    if (request.method() === "PATCH") {
      rows[0] = { ...rows[0], ...request.postDataJSON() };
      return route.fulfill({ json: rows[0] });
    }
    // DELETE only requests the deletion (202); approval removes the row.
    deletions.push(new URL(request.url()).pathname.split("/").at(-1) ?? "");
    requested += 1;
    pendingId = `pending-canned-delete-${requested}`;
    pendingState = "pending";
    return route.fulfill({
      status: 202,
      json: {
        pendingActionId: pendingId,
        action: "delete",
        summary: { cannedResponseId: "snippet-1", name: rows[0]?.name },
        confirmation: "click",
        expiresAt: "2026-10-30T00:00:00.000Z",
        approveUrl: `/api/me/pending-actions/${pendingId}/approve`,
      },
    });
  });
  await page.route(
    "**/api/me/pending-actions/pending-canned-delete-**",
    (route) => {
      const url = route.request().url();
      if (url.endsWith("/cancel")) {
        cancels += 1;
        pendingState = "cancelled";
        return route.fulfill({ json: {} });
      }
      if (url.endsWith("/approve")) {
        approvals += 1;
        pendingState = "executed";
        rows = [];
        return route.fulfill({ json: { id: pendingId, state: pendingState } });
      }
      return route.fulfill({
        json: {
          id: pendingId,
          action: "delete",
          origin: "web",
          targetType: "canned_response",
          targetIds: ["snippet-1"],
          summary: { cannedResponseId: "snippet-1", name: "Acknowledgement" },
          confirmation: "click",
          approvalSupported: true,
          state: pendingState,
          createdAt: "2026-10-06T00:00:00.000Z",
          expiresAt: "2026-10-30T00:00:00.000Z",
          invalidationReason: null,
          decidedAt: null,
          executedAt: null,
          requestingKeyName: null,
        },
      });
    },
  );
  await page.goto(PATH);
  await expect(
    page.getByRole("heading", { name: "Canned responses", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New response" }).click();
  await expect(page).toHaveURL(/id=new/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("{{requester.name}}");
  await expect(dialog).toContainText("{{work_item.key}}");
  await expect(dialog).toContainText("{{work_item.due_date}}");
  await dialog
    .getByLabel("Name", { exact: true })
    .fill("Thanks for your request");
  await dialog
    .locator(".ProseMirror[contenteditable=true]")
    .fill("Thanks. We are investigating.");
  await page.screenshot({
    path: "test-results/kaneo-canned-response-editor.png",
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(JSON.stringify(rows[0]?.body)).toContain("We are investigating.");
  expect(rows[0]?.visibilityDefault).toBe("internal");
  await page
    .getByRole("button", { name: "Edit Thanks for your request", exact: true })
    .click();
  await expect(page).toHaveURL(/id=snippet-1/);
  await dialog.getByLabel("Name", { exact: true }).fill("Acknowledgement");
  await expect(dialog.locator(".ProseMirror")).toContainText(
    "We are investigating.",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("textbox", { name: "Search responses" })
    .fill("Acknowledgement");
  await expect(page).toHaveURL(/q=Acknowledgement/);
  await page.screenshot({
    path: "test-results/kaneo-canned-response-library.png",
  });
  // A `?action=delete` link keeps its own confirmation; cancelling requests nothing.
  await page.goto(`${PATH}?q=Acknowledgement&id=snippet-1&action=delete`);
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete Acknowledgement");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page).not.toHaveURL(/action=delete/);
  expect(deletions).toEqual([]);
  expect(rows).toHaveLength(1);
  // The row button requests deletion directly; the in-place approval is the one
  // confirmation, and cancelling it keeps the response.
  await page
    .getByRole("button", { name: "Delete Acknowledgement", exact: true })
    .click();
  const approval = page
    .getByRole("dialog")
    .filter({ hasText: "Delete canned response" });
  await expect(approval).toBeVisible();
  await expect(page).toHaveURL(
    /\/dashboard\/settings\/workspace\/canned-responses\?q=Acknowledgement$/,
  );
  expect(deletions).toEqual(["snippet-1"]);
  expect(rows).toHaveLength(1);
  await approval.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Deletion request cancelled.")).toBeVisible();
  await expect(approval).not.toBeVisible();
  expect(cancels).toBe(1);
  expect(rows).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Delete Acknowledgement", exact: true }),
  ).toBeVisible();
  // Confirming through the URL-addressed dialog requests, then approval deletes it.
  await page.goto(`${PATH}?q=Acknowledgement&id=snippet-1&action=delete`);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(approval).toBeVisible();
  await expect(page).not.toHaveURL(/action=delete/);
  expect(deletions).toEqual(["snippet-1", "snippet-1"]);
  expect(rows).toHaveLength(1);
  await approval.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Deletion approved.")).toBeVisible();
  await expect(approval).not.toBeVisible();
  await expect(
    page.getByText("No matching responses", { exact: true }),
  ).toBeVisible();
  expect(approvals).toBe(1);
  expect(rows).toHaveLength(0);
});

test("a non-manager direct visit never fetches the management library", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  let requests = 0;
  await page.route("**/api/canned-responses**", async (route) => {
    requests++;
    await route.fulfill({ json: [] });
  });
  await page.goto(`${PATH}?id=new`);
  await expect(
    page.getByText(
      "You need workspace settings permission to manage canned responses.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "New response" }),
  ).not.toBeVisible();
  expect(requests).toBe(0);
});

test("insertion resolves current context and preserves drafts on failure", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      json: { createPublicComments: true, createInternalComments: true },
    }),
  );
  // The detail route's hierarchy, relations and attachments sections read their own
  // envelopes; the shared G11 fixture leaves them unanswered (404).
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/children**`, (route) =>
    route.fulfill({
      json: {
        parent: { ...makeWorkItem(1), title: "Seeded work item 1" },
        ancestors: [],
        data: [],
        page: { nextCursor: null, hasMore: false },
        meta: { total: 0 },
        progress: { completed: 0, total: 0 },
      },
    }),
  );
  await page.route(`**/api/work-items/${WORK_ITEM_KEY}/relations**`, (route) =>
    route.fulfill({ json: { data: [], hiddenCount: 0 } }),
  );
  await page.route(
    `**/api/work-items/${WORK_ITEM_KEY}/attachments**`,
    (route) => route.fulfill({ json: [] }),
  );
  await page.route("**/api/work-items/WLP-1/activity**", (route) =>
    route.fulfill({
      json: { data: [], page: { nextCursor: null, hasMore: false } },
    }),
  );
  await page.route(
    "**/api/work-items/WLP-1/comments/mention-candidates?*",
    (route) => route.fulfill({ json: [] }),
  );
  let dueDate = "2026-10-21";
  let fail = false;
  let reads = 0;
  await page.route("**/api/canned-responses?*", (route) => {
    reads++;
    if (fail)
      return route.fulfill({
        status: 403,
        json: { message: "Access changed" },
      });
    return route.fulfill({
      json: [
        {
          id: "current",
          name: "Current due date",
          visibilityDefault: "internal",
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: `Due ${dueDate}` }],
              },
            ],
          },
        },
      ],
    });
  });
  await page.goto("/agent/work-items/WLP-1");
  // Kaneo's picker popover: a trigger button opening a list of option buttons.
  const select = page.getByRole("button", {
    name: "Canned responses",
    exact: true,
  });
  const option = page.getByRole("dialog").getByRole("button", {
    name: "Current due date",
    exact: true,
  });
  const editor = page
    .getByTestId("work-item-activity")
    .locator(".ProseMirror[contenteditable=true]");
  await expect(select).toBeVisible();
  expect(reads).toBeGreaterThan(0);
  dueDate = "2026-10-25";
  await select.click();
  await option.click();
  await expect(editor).toContainText("Due 2026-10-25");
  await expect(
    page
      .getByRole("group", { name: "Who can see this comment?" })
      .getByRole("button", { name: "Internal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await editor.fill("Keep my edited draft");
  fail = true;
  await select.click();
  await option.click();
  await expect(
    page.getByTestId("work-item-activity").getByRole("alert"),
  ).toContainText("Your draft is preserved");
  await expect(editor).toContainText("Keep my edited draft");
  await page.getByTestId("work-item-activity").screenshot({
    path: "test-results/kaneo-canned-response-insert-error.png",
  });
  fail = false;
  dueDate = "2026-10-26";
  await select.click();
  await option.click();
  await expect(editor).toContainText("Due 2026-10-26");
  await expect(
    page.getByTestId("work-item-activity").getByRole("alert"),
  ).toHaveCount(0);
});
