import { expect, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

const PATH = "/agent/settings/canned-responses";
test("workspace settings creates, edits and deletes reusable replies with URL-addressed dialogs", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({ json: { manageWorkspaceSettings: true } }),
  );
  let rows: Array<{
    id: string;
    name: string;
    body: unknown;
    visibilityDefault: string;
  }> = [];
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
    const deleted = rows[0];
    rows = [];
    return route.fulfill({ json: deleted });
  });
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
  await page
    .getByRole("button", { name: "Delete Acknowledgement", exact: true })
    .click();
  await expect(page).toHaveURL(/action=delete/);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(rows).toHaveLength(1);
  await page
    .getByRole("button", { name: "Delete Acknowledgement", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(
    page.getByText("No matching responses", { exact: true }),
  ).toBeVisible();
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
