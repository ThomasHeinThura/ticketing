import { expect, type Page } from "@playwright/test";

function workListLocators(page: Page) {
  const list = page.locator("div[data-testid=work-item-list-populated]");
  return {
    list,
    table: page.locator("table[data-testid=work-item-list-populated]"),
    backlog: list.getByRole("button", { name: "Backlog 500", exact: true }),
    row: list.locator("[data-virtual-item-id] [data-task-id]").first(),
    assignee: list
      .locator("[data-virtual-item-id]")
      .first()
      .getByTestId("work-item-inline-assignee"),
  };
}

export async function waitForWorkListReadiness(page: Page, timeout = 30_000) {
  const { list, table, backlog, row, assignee } = workListLocators(page);
  try {
    await list.waitFor({ state: "visible", timeout });
    await table.first().waitFor({ state: "detached", timeout });
    await backlog.waitFor({ state: "visible", timeout });
    await row.waitFor({ state: "visible", timeout });
    await assignee.waitFor({ state: "visible", timeout });
  } catch (error) {
    try {
      const [lists, tables, rows, assignees] = await Promise.all([
        list.count(),
        table.count(),
        list.locator("[data-virtual-item-id] [data-task-id]").count(),
        list.getByTestId("work-item-inline-assignee").count(),
      ]);
      console.error(
        "G11 list fixture did not settle:",
        JSON.stringify({ lists, tables, rows, assignees }),
      );
    } catch {
      // Diagnostics are best effort; retain the original readiness failure.
    }
    throw error;
  }
}

export async function assertWorkListReadiness(page: Page) {
  const { list, table, backlog, row, assignee } = workListLocators(page);
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(table).toHaveCount(0, { timeout: 30_000 });
  await expect(backlog).toBeVisible({ timeout: 30_000 });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(assignee).toBeVisible({ timeout: 30_000 });
}
