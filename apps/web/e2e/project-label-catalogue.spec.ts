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
  };
  await page.route("**/api/label/project/project-g11**", async (route) => {
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
    const [removed] = state.rows.splice(index, 1);
    return route.fulfill({ json: removed });
  });
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
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/action=delete/);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  expect(state.rows).toHaveLength(1);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(
    page.getByText("Project urgency", { exact: true }),
  ).not.toBeVisible();
  expect(state.rows).toHaveLength(0);
  expect(state.writes).toBe(3);
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
