import { expect, type Page, test } from "@playwright/test";
import english from "../../../i18n/en-US.json" with { type: "json" };
import {
  DEFAULT_RESOLVED_FEATURES,
  installPerformanceApiFixture,
  makeWorkItem,
  PROJECT,
  PROJECT_ID,
  WORK_ITEM_KEY,
} from "./helpers/g11-performance-fixture";

const saving = english.workItems.journey.saving;
const refusal = (key: "transitionForbidden" | "assignmentConflict") =>
  english.workItems.journey[key].replace(
    "{{term_work_item_one}}",
    english.term.agent.work_item_one,
  );

async function installDetailFixture(page: Page) {
  await installPerformanceApiFixture(page, { workflowCapabilities: true });
  const item = {
    ...makeWorkItem(1),
    startDate: "2026-11-13T00:00:00.000Z",
    dueDate: "2026-11-13T00:00:00.000Z",
    assigneeActive: null as boolean | null,
    assigneeOnProject: null as boolean | null,
  };
  // Serve every read invalidated by settlement explicitly. Shell/other detail reads
  // fall through to the shared fixture, which also answers unmatched reads with 404.
  const reads = new Map<string, number>();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") return route.fallback();
    reads.set(path, (reads.get(path) ?? 0) + 1);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === `/api/work-items/${WORK_ITEM_KEY}`) return json(item);
    if (path === `/api/work-items/${WORK_ITEM_KEY}/activity`)
      return json({ data: [], page: { nextCursor: null, hasMore: false } });
    if (path === `/api/work-items/${WORK_ITEM_KEY}/labels`) return json([]);
    if (path === `/api/work-items/${WORK_ITEM_KEY}/sla`)
      return json({ message: "SLA disabled" }, 404);
    if (path === `/api/work-items/${WORK_ITEM_KEY}/transitions`)
      return json([
        {
          transitionId: "move-progress",
          toStateId: "state-g11-progress",
          toStateTemplateId: "template-state-g11-progress",
          toStateName: "In progress",
          toStateCategory: "started",
          notePolicy: "none",
          available: true,
          blockedBy: [],
        },
      ]);
    if (path === `/api/projects/${PROJECT_ID}/work-items`)
      return json({
        data: [item],
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    if (path === `/api/project/${PROJECT_ID}`) return json(PROJECT);
    if (path.endsWith("/features/resolved"))
      return json({
        features: DEFAULT_RESOLVED_FEATURES.map((feature) =>
          feature.key === "feature.calendar"
            ? { ...feature, enabled: true }
            : feature,
        ),
      });
    return route.fallback();
  });
  return { item, reads };
}

async function holdWrite(page: Page, action: "transition" | "assign") {
  let release = () => {};
  let received = false;
  let payload: unknown;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let respond = () => ({
    status: 403,
    json: { message: "Forbidden" } as object,
  });
  await page.route(
    `**/api/work-items/${WORK_ITEM_KEY}/${action}`,
    async (route) => {
      received = true;
      payload = route.request().postDataJSON();
      await held;
      await route.fulfill(respond());
    },
  );
  return {
    received: () => received,
    payload: () => payload,
    release: (response?: typeof respond) => {
      if (response) respond = response;
      release();
    },
  };
}

async function observeSaving(page: Page) {
  await page.getByTestId("work-item-status").evaluate((element, message) => {
    element.setAttribute("data-saving-count", "0");
    new MutationObserver(() => {
      if (element.textContent === message)
        element.setAttribute(
          "data-saving-count",
          String(Number(element.getAttribute("data-saving-count")) + 1),
        );
    }).observe(element, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }, saving);
}

test("keyboard state choice keeps focus, announces once, refuses both pending controls and rolls back a 403", async ({
  page,
}, testInfo) => {
  await installDetailFixture(page);
  const held = await holdWrite(page, "transition");
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const state = page.getByTestId("work-item-state-control");
  const assignee = page.getByTestId("work-item-assignee-control");
  await expect(state).toContainText("Backlog");
  await observeSaving(page);
  try {
    await state.focus();
    await state.press("Enter");
    const offer = page.getByRole("menuitem", { name: "In progress" });
    await offer.focus();
    await offer.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(held.received).toBe(true);
    await expect(state).toContainText("In progress");
    await expect(state).toBeFocused();
    await expect(state).toHaveAttribute("aria-disabled", "true");
    await expect(assignee).toHaveAttribute("aria-disabled", "true");
    await expect(state).not.toHaveAttribute("disabled");
    await expect(state).toHaveAttribute("aria-busy", "true");
    await expect(state.locator('[aria-label="Loading"]')).toBeVisible();
    await expect(page.getByTestId("work-item-status")).toHaveText(saving);
    await expect(page.getByTestId("work-item-status")).toHaveAttribute(
      "data-saving-count",
      "1",
    );
    await state.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await assignee.focus();
    await assignee.press("Enter");
    await expect(page.locator('[data-slot="popover-popup"]')).toHaveCount(0);
    await expect(page.getByTestId("work-item-status")).toHaveAttribute(
      "data-saving-count",
      "1",
    );
    await page.screenshot({ path: testInfo.outputPath("state-pending.png") });
  } finally {
    held.release();
  }
  await expect(state).toContainText("Backlog");
  await expect(state).toBeEnabled();
  await expect(assignee).toBeEnabled();
  await expect(
    page.getByText(refusal("transitionForbidden"), { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("state-refused.png") });
});

test("assignee choice closes immediately, keeps keyboard focus and settles with the new holder", async ({
  page,
}, testInfo) => {
  const { item } = await installDetailFixture(page);
  const held = await holdWrite(page, "assign");
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const assignee = page.getByTestId("work-item-assignee-control");
  await expect(assignee).toContainText("Unassigned");
  await observeSaving(page);
  try {
    await assignee.focus();
    await assignee.press("Enter");
    const person = page
      .locator('[data-slot="popover-popup"]')
      .getByRole("button", { name: /G11 Agent/ });
    await person.focus();
    await person.press("Enter");
    await expect.poll(held.received).toBe(true);
    await expect(assignee).toContainText("G11 Agent");
    await expect(assignee).toBeFocused();
    await expect(assignee).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('[data-slot="popover-popup"]')).toHaveCount(0);
    await expect(page.getByTestId("work-item-status")).toHaveAttribute(
      "data-saving-count",
      "1",
    );
    expect(held.payload()).toEqual({
      assigneeId: "person-g11",
      expectedCurrentAssigneeId: null,
    });
    await page.screenshot({
      path: testInfo.outputPath("assignee-pending.png"),
    });
  } finally {
    held.release(() => {
      Object.assign(item, {
        assigneeId: "person-g11",
        assigneeName: "G11 Agent",
        assigneeActive: true,
        assigneeOnProject: true,
        version: 2,
      });
      return {
        status: 200,
        json: {
          key: WORK_ITEM_KEY,
          assigneeId: "person-g11",
          previousAssigneeId: null,
          version: 2,
        },
      };
    });
  }
  await expect(assignee).toBeEnabled();
  await expect(assignee).toContainText("G11 Agent");
  await page.reload();
  await expect(assignee).toContainText("G11 Agent");
});

test("a holder-changed 409 keeps the original precondition and refreshes to the actual holder", async ({
  page,
}, testInfo) => {
  const { item } = await installDetailFixture(page);
  const held = await holdWrite(page, "assign");
  await page.goto(`/agent/work-items/${WORK_ITEM_KEY}`);
  const assignee = page.getByTestId("work-item-assignee-control");
  await assignee.click();
  try {
    await page
      .locator('[data-slot="popover-popup"]')
      .getByRole("button", { name: /G11 Agent/ })
      .click();
    await expect.poll(held.received).toBe(true);
    await expect(assignee).toContainText("G11 Agent");
    expect(held.payload()).toEqual({
      assigneeId: "person-g11",
      expectedCurrentAssigneeId: null,
    });
  } finally {
    held.release(() => {
      Object.assign(item, {
        assigneeId: "sam",
        assigneeName: "Sam",
        assigneeActive: true,
        assigneeOnProject: true,
        version: 2,
      });
      return { status: 409, json: { message: "holder changed" } };
    });
  }
  await expect(assignee).toBeEnabled();
  await expect(assignee).toContainText("Sam");
  await expect(
    page.getByText(refusal("assignmentConflict"), { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("holder-changed.png") });
});

test("Calendar side pane sends a state change with the schedule query loaded and settles its refetch", async ({
  page,
}, testInfo) => {
  const { item, reads } = await installDetailFixture(page);
  const held = await holdWrite(page, "transition");
  await page.goto("/agent/projects/WLP/calendar?month=2026-11");
  await page
    .getByRole("button", { name: /Seeded work item 1/ })
    .first()
    .click();
  const state = page.getByTestId("work-item-state-control");
  await expect(state).toContainText("Backlog");
  const before = reads.get(`/api/projects/${PROJECT_ID}/work-items`) ?? 0;
  expect(before).toBeGreaterThan(0);
  try {
    await state.click();
    await page.getByRole("menuitem", { name: "In progress" }).click();
    await expect.poll(held.received).toBe(true);
    await expect(state).toContainText("In progress");
    await expect(state).toHaveAttribute("aria-disabled", "true");
    await page.screenshot({
      path: testInfo.outputPath("calendar-pending.png"),
    });
  } finally {
    held.release(() => {
      Object.assign(item, {
        stateId: "state-g11-progress",
        stateName: "In progress",
        stateCategory: "started",
        version: 2,
      });
      return {
        status: 200,
        json: {
          key: WORK_ITEM_KEY,
          stateId: item.stateId,
          assigneeId: null,
          resolvedAt: null,
          version: 2,
        },
      };
    });
  }
  await expect(state).toBeEnabled();
  await expect(state).toContainText("In progress");
  await expect
    .poll(() => reads.get(`/api/projects/${PROJECT_ID}/work-items`) ?? 0)
    .toBeGreaterThan(before);
  await page.screenshot({ path: testInfo.outputPath("calendar-saved.png") });
});
