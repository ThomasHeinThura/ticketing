import { expect, type Page, test } from "@playwright/test";
import { installPerformanceApiFixture } from "./helpers/g11-performance-fixture";

const PATH = "/agent/projects/WLP/settings/labels";
const CANONICAL = "/dashboard/settings/projects/project-g11/labels";
type LabelRow = {
  id: string;
  name: string;
  color: string;
  projectId: string;
  workspaceId: string;
};

async function installCatalogue(page: Page, manageLabels = true) {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      json: {
        manageLabels,
        createLabels: !manageLabels,
        updateLabels: !manageLabels,
        deleteLabels: !manageLabels,
      },
    }),
  );
  const state = {
    rows: [] as LabelRow[],
    writes: 0,
    failRead: false,
    holdCreate: undefined as undefined | (() => Promise<void>),
    deletions: [] as string[],
    pendingId: "",
    pendingState: "pending",
    approvals: 0,
    cancels: 0,
  };
  await page.route(
    "**/api/label/project/project-g11/catalogue**",
    async (route) => {
      const request = route.request();
      if (request.method() === "GET")
        return route.fulfill(
          state.failRead
            ? { status: 503, json: { message: "Catalogue unavailable" } }
            : { json: state.rows },
        );
      state.writes++;
      if (request.method() === "POST") {
        await state.holdCreate?.();
        const row = {
          id: `label-${state.writes}`,
          projectId: "project-g11",
          workspaceId: "ws-g11",
          ...request.postDataJSON(),
        };
        state.rows.push(row);
        return route.fulfill({ json: row });
      }
      const id = new URL(request.url()).pathname.split("/").at(-1);
      const index = state.rows.findIndex((row) => row.id === id);
      if (request.method() === "PATCH") {
        state.rows[index] = { ...state.rows[index], ...request.postDataJSON() };
        return route.fulfill({ json: state.rows[index] });
      }
      // DELETE only requests the deletion (202); approval removes the row.
      state.deletions.push(id ?? "");
      state.pendingId = `pending-label-delete-${state.deletions.length}`;
      state.pendingState = "pending";
      return route.fulfill({
        status: 202,
        json: {
          pendingActionId: state.pendingId,
          action: "delete",
          summary: { name: state.rows[index]?.name },
          confirmation: "click",
          expiresAt: "2026-10-30T00:00:00.000Z",
          approveUrl: `/api/me/pending-actions/${state.pendingId}/approve`,
        },
      });
    },
  );
  await page.route(
    "**/api/me/pending-actions/pending-label-delete-**",
    (route) => {
      const url = route.request().url();
      const target = state.deletions.at(-1) ?? "";
      if (url.endsWith("/cancel")) {
        state.cancels++;
        state.pendingState = "cancelled";
        return route.fulfill({ json: {} });
      }
      if (url.endsWith("/approve")) {
        state.approvals++;
        state.pendingState = "executed";
        state.rows = state.rows.filter((row) => row.id !== target);
        return route.fulfill({
          json: { id: state.pendingId, state: state.pendingState },
        });
      }
      return route.fulfill({
        json: {
          id: state.pendingId,
          action: "delete",
          origin: "web",
          targetType: "project_label",
          targetIds: [target],
          summary: {
            name: state.rows.find((row) => row.id === target)?.name,
          },
          confirmation: "click",
          approvalSupported: true,
          state: state.pendingState,
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
  return state;
}

test("project catalogue preserves Kaneo settings and CRUD across URL reloads", async ({
  page,
}) => {
  const state = await installCatalogue(page);
  await page.goto(PATH);
  await expect(page).toHaveURL(new RegExp(`${CANONICAL}$`));
  await expect(
    page.getByRole("heading", { name: "Labels", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create Label", exact: true }).click();
  await expect(page).toHaveURL(/action=create/);
  const dialog = page.getByRole("dialog", { name: /^(Create|Edit) Label$/ });
  await dialog.getByLabel("Label name").fill("Project priority");
  await page.screenshot({
    path: "test-results/kaneo-project-label-create.png",
  });
  await dialog
    .getByRole("button", { name: "Create Label", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Project priority", { exact: true }),
  ).toBeVisible();
  expect(state.rows[0]?.projectId).toBe("project-g11");
  await page.getByRole("button", { name: "Edit Label", exact: true }).click();
  await expect(page).toHaveURL(/action=edit.*label=label-1/);
  await page.reload();
  await expect(dialog.getByLabel("Label name")).toHaveValue("Project priority");
  await dialog.getByLabel("Label name").fill("Project urgency");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Project urgency", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/kaneo-project-label-catalogue.png",
  });
  // A `?action=delete&label=` link keeps its own confirmation; cancelling requests nothing.
  await page.goto(`${CANONICAL}?action=delete&label=label-1`);
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page).not.toHaveURL(/action=delete/);
  expect(state.deletions).toEqual([]);
  expect(state.rows).toHaveLength(1);
  // The row button requests deletion directly; the in-place approval is the one
  // confirmation, and cancelling it keeps the label.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const approval = page
    .getByRole("dialog")
    .filter({ hasText: "Delete project label" });
  await expect(approval).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${CANONICAL}$`));
  expect(state.deletions).toEqual(["label-1"]);
  expect(state.rows).toHaveLength(1);
  await approval.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Deletion request cancelled.")).toBeVisible();
  await expect(approval).not.toBeVisible();
  expect(state.cancels).toBe(1);
  await expect(
    page.getByText("Project urgency", { exact: true }),
  ).toBeVisible();
  // Confirming through the URL-addressed dialog requests, then approval deletes it.
  await page.goto(`${CANONICAL}?action=delete&label=label-1`);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(approval).toBeVisible();
  expect(state.deletions).toEqual(["label-1", "label-1"]);
  expect(state.rows).toHaveLength(1);
  await approval.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Deletion approved.")).toBeVisible();
  await expect(approval).not.toBeVisible();
  await expect(
    page.getByText("Project urgency", { exact: true }),
  ).not.toBeVisible();
  expect(state.approvals).toBe(1);
  expect(state.rows).toHaveLength(0);
  // Create, edit and two deletion requests; only approval removed the label.
  expect(state.writes).toBe(4);
});

test("legacy label grants do not expose project management controls", async ({
  page,
}) => {
  const state = await installCatalogue(page, false);
  state.rows.push({
    id: "read-only",
    name: "Visible project label",
    color: "blue",
    projectId: "project-g11",
    workspaceId: "ws-g11",
  });
  await page.goto(`${PATH}?action=edit&label=read-only`);
  await expect(
    page.getByText("Visible project label", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Label", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit Label", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.writes).toBe(0);
});

test("late create response preserves a reopened dialog and its new draft", async ({
  page,
}) => {
  const state = await installCatalogue(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.holdCreate = () => held;
  await page.goto(PATH);
  await page.getByRole("button", { name: "Create Label", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^(Create|Edit) Label$/ });
  await dialog.getByLabel("Label name").fill("First submission");
  await dialog
    .getByRole("button", { name: "Create Label", exact: true })
    .click();
  await expect.poll(() => state.writes).toBe(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Create Label", exact: true }).click();
  await dialog.getByLabel("Label name").fill("New unsaved draft");
  release();
  await expect(
    page.getByText("First submission", { exact: true }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Label name")).toHaveValue(
    "New unsaved draft",
  );
  await expect(page).toHaveURL(/action=create/);
  expect(state.writes).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("catalogue load failures offer a real retry", async ({ page }) => {
  const state = await installCatalogue(page);
  state.failRead = true;
  await page.goto(PATH);
  await expect(page.getByRole("alert")).toContainText("Catalogue unavailable", {
    timeout: 20000,
  });
  state.failRead = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Label", exact: true }),
  ).toBeVisible();
});

test("project label settings stay usable on mobile with dark theme and reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installCatalogue(page);
  await page.goto(PATH);
  await page.getByRole("button", { name: "Create Label", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create Label",
    exact: true,
  });
  await dialog.getByLabel("Label name").fill("Mobile label");
  await expect(dialog).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/kaneo-project-label-mobile-dark.png",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("workspace catalogue keeps its existing Kaneo surface and URL-addressed editor", async ({
  page,
}) => {
  await installPerformanceApiFixture(page);
  await page.route("**/api/capabilities**", (route) =>
    route.fulfill({
      json: {
        createLabels: true,
        updateLabels: true,
        deleteLabels: true,
        manageLabels: false,
      },
    }),
  );
  await page.route("**/api/label/workspace/ws-g11", (route) =>
    route.fulfill({
      json: [
        {
          id: "workspace-label",
          name: "Workspace priority",
          color: "teal",
          projectId: null,
          workspaceId: "ws-g11",
          taskId: null,
        },
      ],
    }),
  );
  await page.goto("/agent/settings/labels?action=edit&label=workspace-label");
  const dialog = page.getByRole("dialog", { name: "Edit Label", exact: true });
  await expect(dialog.getByLabel("Label name")).toHaveValue(
    "Workspace priority",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Labels", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Workspace priority", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/kaneo-workspace-label-catalogue.png",
  });
});
