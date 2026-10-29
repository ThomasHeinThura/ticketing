import { expect, type Page, test } from "@playwright/test";
import {
  installPerformanceApiFixture,
  makeWorkItem,
  PROJECT_ID,
  WORK_ITEM_KEY,
  WORKSPACE_ID,
} from "./helpers/g11-performance-fixture";

const STATES = [
  { id: "state-backlog", name: "Backlog", group: "backlog" },
  { id: "state-todo", name: "Todo", group: "unstarted" },
  { id: "state-in-progress", name: "In progress", group: "started" },
  { id: "state-review", name: "Review", group: "started" },
  { id: "state-done", name: "Done", group: "completed" },
].map((state, index) => ({
  ...state,
  stateTemplateId: `template-${state.id.slice("state-".length)}`,
  position: index + 1,
  isDefault: index === 0,
}));
const BOARD_ITEM_COUNT = 200;
// A column with more than 50 cards virtualises (only visible rows are in the DOM). Forty per
// state keeps every one of the 200 cards rendered, also after WLP-1 moves to In progress.
const ITEMS_PER_STATE = BOARD_ITEM_COUNT / STATES.length;
const CAPABILITIES = {
  manageProjects: false,
  manageProjectSettings: false,
  createProjects: false,
  updateProjects: false,
  deleteProjects: false,
  updateTasks: true,
  createTasks: true,
  deleteTasks: true,
  assignTasks: true,
  transitionTasks: true,
  rankTasks: true,
  createLabels: false,
  updateLabels: false,
  deleteLabels: false,
  manageWorkspace: false,
  deleteWorkspace: false,
  inviteUsers: false,
  manageTeam: false,
  removeMembers: false,
  createPublicComments: true,
  createInternalComments: true,
};
// WLP-1 left Backlog in the detail step; the keyboard drag reorders the next card.
const DRAG_KEY = "WLP-2";
const PERSON = { personId: "person-g11", name: "G11 Agent" };

function boardItem(number: number) {
  const state = STATES[Math.floor((number - 1) / ITEMS_PER_STATE)];
  return {
    ...makeWorkItem(number),
    stateId: state.id,
    stateName: state.name,
    stateCategory: state.group,
    position: (((number - 1) % ITEMS_PER_STATE) + 1).toFixed(10),
  };
}

const pathOf = (url: string) => new URL(url).pathname.replace(/\/+$/, "");

/**
 * Spec-local, stateful routes in front of the shared G11 fixture: a five-state project with
 * exactly 200 work items (40 per state, so no column virtualises and every card is in the
 * DOM), the WLP-1 detail with its transition, assignment and rank writes persisted into
 * the same rows the board and detail read back, and the capabilities those writes need.
 */
async function installBoardSmokeRoutes(page: Page) {
  const items = Array.from({ length: BOARD_ITEM_COUNT }, (_, index) =>
    boardItem(index + 1),
  );
  const detail = () => ({
    ...items[0],
    assigneeActive: items[0].assigneeId ? true : null,
    assigneeOnProject: items[0].assigneeId ? true : null,
  });
  const settings: Record<string, unknown> = {};
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = pathOf(request.url());
    // The shared fixture's capability map plus the two the canonical writes are gated on.
    if (path === "/api/capabilities" && method === "GET")
      return route.fulfill(json(CAPABILITIES));
    if (path === `/api/projects/${PROJECT_ID}/states` && method === "GET")
      return route.fulfill(json(STATES));
    if (path === `/api/projects/${PROJECT_ID}/work-items` && method === "GET")
      return route.fulfill(
        json({
          data: items,
          page: { hasMore: false, nextCursor: null },
          meta: {},
        }),
      );
    // The list layout reads the same rows through the structured search.
    if (path === "/api/work-items/search" && method === "POST")
      return route.fulfill(
        json({
          data: items,
          page: { hasMore: false, nextCursor: null },
          meta: { total: items.length },
        }),
      );
    // The layout switch persists the per-project layout preference (`VW-2`).
    if (path === "/api/me/settings" && method === "PATCH") {
      Object.assign(settings, request.postDataJSON());
      return route.fulfill(json({ settings }));
    }
    if (path === `/api/projects/${PROJECT_ID}/assignable` && method === "GET")
      return route.fulfill(
        json([{ ...PERSON, roleName: "Owner", openWorkCount: 0 }]),
      );
    if (path === `/api/work-items/${WORK_ITEM_KEY}` && method === "GET")
      return route.fulfill(json(detail()));
    if (
      path === `/api/work-items/${WORK_ITEM_KEY}/transitions` &&
      method === "GET"
    )
      return route.fulfill(
        json(
          STATES.filter((state) => state.id !== items[0].stateId).map(
            (state) => ({
              transitionId: `transition-${state.id}`,
              toStateTemplateId: state.stateTemplateId,
              toStateName: state.name,
              toStateId: state.id,
              toStateCategory: state.group,
              notePolicy: "none",
              noteVisibility: "internal",
              requiresApproval: false,
              requiresCab: false,
              isReopen: false,
              available: true,
              blockedBy: [],
            }),
          ),
        ),
      );
    if (
      path === `/api/work-items/${WORK_ITEM_KEY}/transition` &&
      method === "POST"
    ) {
      const { toStateTemplateId } = request.postDataJSON() as {
        toStateTemplateId: string;
      };
      const state = STATES.find(
        (candidate) => candidate.stateTemplateId === toStateTemplateId,
      );
      if (!state) return route.fulfill(json({ message: "Unknown state" }, 422));
      items[0] = {
        ...items[0],
        stateId: state.id,
        stateName: state.name,
        stateCategory: state.group,
        version: items[0].version + 1,
      };
      return route.fulfill(
        json({
          key: WORK_ITEM_KEY,
          stateId: state.id,
          assigneeId: items[0].assigneeId,
          resolvedAt: null,
          version: items[0].version,
        }),
      );
    }
    if (
      path === `/api/work-items/${WORK_ITEM_KEY}/assign` &&
      method === "POST"
    ) {
      const { assigneeId } = request.postDataJSON() as { assigneeId: string };
      if (assigneeId !== PERSON.personId)
        return route.fulfill(json({ message: "Not assignable" }, 400));
      const previousAssigneeId = items[0].assigneeId;
      items[0] = {
        ...items[0],
        assigneeId: PERSON.personId,
        assigneeName: PERSON.name,
        version: items[0].version + 1,
      } as (typeof items)[number];
      return route.fulfill(
        json({
          key: WORK_ITEM_KEY,
          assigneeId: PERSON.personId,
          previousAssigneeId,
          version: items[0].version,
        }),
      );
    }
    const rank = path.match(/^\/api\/work-items\/(WLP-\d+)\/rank$/);
    if (rank && method === "POST") {
      const { beforeId, afterId } = request.postDataJSON() as {
        beforeId?: string;
        afterId?: string;
      };
      const index = items.findIndex((item) => item.key === rank[1]);
      const before = items.find((item) => item.id === beforeId);
      const after = items.find((item) => item.id === afterId);
      const moved = items[index];
      if (
        index === -1 ||
        (!before && !after) ||
        [before, after].some(
          (neighbour) => neighbour && neighbour.stateId !== moved.stateId,
        )
      )
        return route.fulfill(json({ message: "Invalid neighbours" }, 400));
      const low = before ? Number(before.position) : 0;
      const high = after ? Number(after.position) : low + 2;
      items[index] = {
        ...moved,
        position: ((low + high) / 2).toFixed(10),
        version: moved.version + 1,
      };
      return route.fulfill(
        json({
          key: moved.key,
          position: items[index].position,
          version: items[index].version,
        }),
      );
    }
    return route.fallback();
  });
  return items;
}

test("responsive task properties, real fixture writes, help, and 200-card board", async ({
  browser,
}) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await installPerformanceApiFixture(page);
      const items = await installBoardSmokeRoutes(page);
      const writes: string[] = [];
      const successfulBoardListGets: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET")
          writes.push(`${request.method()} ${pathOf(request.url())}`);
      });
      page.on("response", (response) => {
        const request = response.request();
        const pathname = pathOf(response.url());
        if (
          request.method() === "GET" &&
          pathname === `/api/projects/${PROJECT_ID}/work-items` &&
          response.ok()
        ) {
          successfulBoardListGets.push(pathname);
        }
      });

      const itemReady = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          pathOf(response.url()) === `/api/work-items/${WORK_ITEM_KEY}` &&
          response.ok(),
      );
      // The old Kaneo task link still lands on the canonical work-item detail.
      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
      );
      await expect(page).toHaveURL(
        new RegExp(`/agent/work-items/${WORK_ITEM_KEY}$`),
      );
      await itemReady;

      const status = page.locator(
        '[data-testid="work-item-state-control"]:visible',
      );
      await expect(status).toHaveCount(1);
      await expect(status).toHaveText("Backlog");
      await status.click();
      await page
        .getByRole("button", { name: /^In progress/ })
        .last()
        .click();
      await expect(status).toHaveText("In progress");
      await expect(status).toHaveAttribute("aria-expanded", "false");

      const assignee = page.locator(
        '[data-testid="work-item-assignee-control"]:visible',
      );
      await expect(assignee).toHaveCount(1);
      await expect(assignee).toHaveText("Unassigned");
      await assignee.click();
      await page
        .getByRole("button", { name: /G11 Agent/ })
        .last()
        .click();
      await expect(assignee).toHaveText(/G11 Agent/);
      await expect(assignee).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(() => writes)
        .toEqual([
          `POST /api/work-items/${WORK_ITEM_KEY}/transition`,
          `POST /api/work-items/${WORK_ITEM_KEY}/assign`,
        ]);
      expect(items[0]).toMatchObject({
        stateId: "state-in-progress",
        assigneeId: PERSON.personId,
        version: 3,
      });

      await page.keyboard.press("?");
      const help = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
      await expect(help).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();

      // The old Kaneo board link still lands on the canonical work-item board.
      await page.goto(
        `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/board`,
      );
      await expect(page).toHaveURL(
        /\/agent\/projects\/WLP\/work\?.*layout=board/,
      );
      const cards = page.getByTestId("work-item-board-card");
      await expect(cards).toHaveCount(BOARD_ITEM_COUNT);
      expect(successfulBoardListGets.length).toBeGreaterThan(0);
      await expect(
        page.getByText("Seeded work item 200", { exact: true }),
      ).toBeVisible();

      await page.evaluate(() => document.fonts.ready);
      const terminalCard = page.locator('[data-work-item-key="WLP-200"]');
      const cardGeometry = await terminalCard.evaluate((card) => ({
        height: card.getBoundingClientRect().height,
        columnOffset: (card as HTMLElement).offsetTop,
      }));
      await terminalCard.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          terminalCard.evaluate((card) => ({
            height: card.getBoundingClientRect().height,
            columnOffset: (card as HTMLElement).offsetTop,
          })),
        )
        .toEqual(cardGeometry);

      const addTask = page.getByTestId("work-item-board-column-create").first();
      await addTask.focus();
      await addTask.click();
      const createTaskDialog = page.getByRole("dialog");
      await expect(createTaskDialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(createTaskDialog).toBeHidden();
      await expect(addTask).toBeFocused();

      await page.getByRole("button", { name: "List", exact: true }).click();
      await expect(page).toHaveURL(/layout=list/);
      const listAddTask = page
        .getByRole("button", { name: "Add Work item", exact: true })
        .first();
      await listAddTask.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByRole("button", { name: "Board", exact: true }).click();
      await expect(cards).toHaveCount(BOARD_ITEM_COUNT);

      // The Kaneo card is a labelled group (not a role=button) carrying dnd-kit's keyboard
      // instructions.
      const keyboardCard = page
        .getByRole("group", {
          name: "Work item WLP-2: Seeded work item 2",
          exact: true,
        })
        .and(
          page.locator(
            '[data-task-id="work-item-2"][aria-describedby^="DndDescribedBy"]',
          ),
        );
      const liftedKeyboardCard = page.locator(
        '[data-task-id="work-item-2"][data-task-dragging="true"]',
      );
      const announcement = (text: string) =>
        page.locator('[aria-live="assertive"]').filter({ hasText: text });
      const rankWrites: Array<{ path: string; body: unknown }> = [];
      page.on("request", (request) => {
        const path = pathOf(request.url());
        // Structured search uses POST for a read; retain every actual work-item mutation.
        if (
          request.method() !== "GET" &&
          path.startsWith("/api/work-items/") &&
          !(request.method() === "POST" && path === "/api/work-items/search")
        ) {
          rankWrites.push({ path, body: request.postDataJSON() });
        }
      });

      await keyboardCard.focus();
      await expect(keyboardCard).toBeFocused();
      await page.keyboard.press("Space");
      await expect(liftedKeyboardCard).toHaveCount(1);
      await expect(announcement("Picked up Seeded work item 2.")).toHaveCount(
        1,
      );
      await page.keyboard.press("Escape");
      await expect(liftedKeyboardCard).toHaveCount(0);
      await expect(
        announcement("Moving Seeded work item 2 was cancelled."),
      ).toHaveCount(1);
      expect(rankWrites).toHaveLength(0);

      await keyboardCard.focus();
      await page.keyboard.press("Space");
      await expect(liftedKeyboardCard).toHaveCount(1);
      await expect(announcement("Picked up Seeded work item 2.")).toHaveCount(
        1,
      );
      await page.keyboard.press("ArrowDown");
      await expect(
        announcement("Seeded work item 2 is over Seeded work item 3."),
      ).toHaveCount(1);
      const keyboardDrop = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          pathOf(response.url()) === `/api/work-items/${DRAG_KEY}/rank` &&
          response.ok(),
      );
      await page.keyboard.press("Space");
      await expect(
        announcement("Seeded work item 2 was dropped on Seeded work item 3."),
      ).toHaveCount(1);
      await keyboardDrop;
      // One canonical rank write names the new neighbours (the legacy board rewrote the
      // position of every card in the column instead).
      expect(rankWrites).toEqual([
        {
          path: `/api/work-items/${DRAG_KEY}/rank`,
          body: { beforeId: "work-item-3", afterId: "work-item-4" },
        },
      ]);
      await expect(
        page.getByText(
          `WLP-2 moved to position 2 of ${ITEMS_PER_STATE - 1} in Backlog.`,
          {
            exact: true,
          },
        ),
      ).toHaveCount(1);
      // The persisted order is read back: WLP-2 now renders after WLP-3.
      await expect
        .poll(() =>
          page
            .locator(
              '[data-testid="work-item-board-column"][data-state-id="state-backlog"] [data-testid="work-item-board-card"]',
            )
            .evaluateAll((nodes) =>
              nodes
                .slice(0, 3)
                .map((node) => node.getAttribute("data-work-item-key")),
            ),
        )
        .toEqual(["WLP-3", "WLP-2", "WLP-4"]);
    } finally {
      if (context.pages().some((page) => !page.isClosed())) {
        await context.close();
      }
    }
  }
});
