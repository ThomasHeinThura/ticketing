import type { Page } from "@playwright/test";
import { createVersionedTaskFixture } from "./versioned-task-fixture";

const G13_TRANSITIONS = [
  "work-list",
  "detail",
  "board",
  "legacy-task",
  "projects",
  "sign-in",
  "red-probe",
] as const;

export type G13Transition = (typeof G13_TRANSITIONS)[number];

export type G13WindowMetric = {
  skeletonMark: number;
  contentMark: number;
  cls: number;
  skeletonPending: boolean;
  contentPending: boolean;
  inputShiftCount: number;
};

export type BrowserMetrics = {
  lcp: number;
  cls: number;
  interactionStart: number;
  interactionPaint: number;
  routeStart: number;
  routePaint: number;
  documentStart: number;
  listPaint: number;
  boardPaint: number;
  signInStart: number;
  signInPaint: number;
  paletteStart: number;
  paletteInsert: number;
  palettePaint: number;
  paletteNavigationStart: number;
  paletteNavigationPaint: number;
  stateStart: number;
  statePaint: number;
  assignmentStart: number;
  assignmentPaint: number;
  commentStart: number;
  commentPaint: number;
  g13: Record<G13Transition, G13WindowMetric>;
  lcpElement: string;
  lcpText: string;
  lcpUrl: string;
  dragFrameTimes?: number[];
};

export type G11Window = Window & { __g11Metrics: BrowserMetrics };

export const WORK_LIST_PATH = "/agent/projects/WLP/work?layout=list";
export const PERFORMANCE_BASE_URL = "http://127.0.0.1:4178";
export const WORK_ITEM_KEY = "WLP-1";
export const WORKSPACE_ID = "ws-g11";
export const PROJECT_ID = "project-g11";
export const TYPE_ID = "type-g11";
const PROJECT_KEY = "WLP";
/** A fresh deployment's resolved switches (`FEATURE_FLAG_DEFAULTS` in @taskdesk/permissions). */
const DEFAULT_RESOLVED_FEATURES = [
  "feature.cycles",
  "feature.modules",
  "feature.estimates",
  "feature.intake",
  "feature.sla",
  "feature.approvals",
  "feature.time_tracking",
  "feature.cost_tracking",
  "feature.knowledge_base",
  "feature.service_catalogue",
  "feature.customer_portal",
  "feature.reports",
  "feature.automations",
  "feature.timeline",
  "feature.calendar",
  "feature.pages",
  "feature.mcp",
  "feature.public_boards",
  "feature.dev_links",
]
  .map((key) => ({ key, enabled: false }))
  .concat([
    { key: "feature.scim", enabled: true },
    { key: "feature.import", enabled: true },
  ]);
const SESSION = {
  session: {
    id: "session-g11",
    userId: "user-g11",
    token: "g11",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    activeOrganizationId: WORKSPACE_ID,
  },
  user: {
    id: "user-g11",
    name: "G11 Agent",
    email: "g11@example.test",
    emailVerified: true,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  },
};

const PROJECT = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  slug: "WLP",
  name: "Performance fixture",
  description: null,
  icon: null,
  defaultCommentVisibility: "internal",
  createdAt: "2026-09-30T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  position: 1,
  lastTaskNumber: 500,
  statistics: {
    completionPercentage: 0,
    totalTasks: 500,
    dueDate: null,
  },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

export function makeWorkItem(number: number) {
  return {
    id: `work-item-${number}`,
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    typeId: TYPE_ID,
    number,
    key: `WLP-${number}`,
    title: `Seeded work item ${number}`,
    description: null,
    stateId: "state-g11",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: number % 4 === 0 ? null : "medium",
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: number.toFixed(10),
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  };
}

function makeDetailItem() {
  return {
    ...makeWorkItem(1),
    title: "Seeded work item 1",
  };
}

function makeBoardProject(
  deletedTaskIds: Set<string> = new Set(),
  taskStore?: ReturnType<typeof createVersionedTaskFixture>,
) {
  const columns = [
    { id: "backlog", name: "Backlog", slug: "backlog", isFinal: false },
    {
      id: "in-progress",
      name: "In progress",
      slug: "in-progress",
      isFinal: false,
    },
    { id: "review", name: "Review", slug: "review", isFinal: false },
    { id: "done", name: "Done", slug: "done", isFinal: true },
  ].map((column, columnIndex) => ({
    ...column,
    icon: null,
    color: null,
    position: columnIndex,
    tasks: Array.from({ length: 200 }, (_, index) => {
      const number = index + 1;
      const originalColumnIndex = Math.floor(index / 50);
      const originalColumn = ["backlog", "in-progress", "review", "done"][
        originalColumnIndex
      ];
      const seededTask = {
        id: `legacy-task-${number}`,
        title: `Seeded legacy task ${number}`,
        number,
        description: null,
        status: originalColumn,
        priority: null,
        startDate: null,
        dueDate: null,
        position: index % 50,
        createdAt: "2026-09-30T00:00:00.000Z",
        updatedAt: "2026-09-30T00:00:00.000Z",
        userId: null,
        assigneeId: null,
        assigneeName: null,
        projectId: PROJECT_ID,
        columnId: originalColumn,
        version: 1,
        labels: [],
        externalLinks: [],
      };
      return taskStore?.getTask(seededTask.id) ?? seededTask;
    })
      .filter(
        (task) => task.status === column.slug && !deletedTaskIds.has(task.id),
      )
      .map((task) => ({ ...task, columnId: column.id }))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
  }));

  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    slug: "WLP",
    name: "Performance fixture",
    icon: null,
    description: "",
    columns,
    archivedTasks: [],
    plannedTasks: [],
  };
}

const SEEDED_ITEMS = Array.from({ length: 500 }, (_, index) =>
  makeWorkItem(index + 1),
);

/**
 * The canonical board fixture (G11 board render, drag and context menu): a second project,
 * `BRD`, whose 200 work items sit 50 per state across four states, as the legacy board's 200
 * cards did. A canonical board column virtualizes only above 50 cards, so all 200 cards are in
 * the DOM. Opt-in (`boardProject`), so the 500-item `WLP` list and its specs are unchanged.
 */
export const BOARD_PROJECT_KEY = "BRD";
export const BOARD_PROJECT_ID = "project-g11-board";
export const BOARD_ITEM_COUNT = 200;
export const BOARD_STATES = [
  { id: "state-brd-backlog", name: "Backlog", group: "backlog" },
  { id: "state-brd-progress", name: "In progress", group: "started" },
  { id: "state-brd-review", name: "Review", group: "started" },
  { id: "state-brd-done", name: "Done", group: "completed" },
] as const;
const BOARD_PROJECT = {
  ...PROJECT,
  id: BOARD_PROJECT_ID,
  slug: BOARD_PROJECT_KEY,
  name: "Performance board",
  position: 2,
  lastTaskNumber: BOARD_ITEM_COUNT,
  statistics: {
    completionPercentage: 0,
    totalTasks: BOARD_ITEM_COUNT,
    dueDate: null,
  },
};

export function boardItemId(number: number) {
  return `board-item-${number}`;
}

function makeBoardItem(number: number) {
  const state = BOARD_STATES[Math.floor((number - 1) / 50)];
  return {
    ...makeWorkItem(number),
    id: boardItemId(number),
    projectId: BOARD_PROJECT_ID,
    key: `${BOARD_PROJECT_KEY}-${number}`,
    title: `Seeded board item ${number}`,
    stateId: state.id,
    stateName: state.name,
    stateCategory: state.group,
    position: (((number - 1) % 50) + 1).toFixed(10),
  };
}

/** One canonical transition offer per target state, in the API's `WorkItemTransitionOffer` shape. */
function transitionOffer(state: { id: string; name: string; group: string }) {
  return {
    transitionId: `transition-${state.id}`,
    toStateTemplateId: `template-${state.id}`,
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
  };
}

/** The `WLP-1` detail's single workflow move (G11 state change): Backlog -> In progress. */
const DETAIL_PROGRESS_STATE = {
  id: "state-g11-progress",
  name: "In progress",
  group: "started",
} as const;

/** The assignable roster (`AssignablePerson`): the signed-in agent. */
const ASSIGNABLE_PERSON = {
  personId: "person-g11",
  name: SESSION.user.name,
  roleName: "Owner",
  openWorkCount: 0,
};

// Shared by the canonical G11 suite and its post-run diagnostic so both use
// the same handlers and datasets without duplicating fixture setup.
export async function installPerformanceApiFixture(
  page: Page,
  {
    authenticated = true,
    dataDelayMs = 0,
    g13Windows = false,
    workflowCapabilities = false,
    boardProject = false,
  }: {
    authenticated?: boolean;
    dataDelayMs?: number;
    g13Windows?: boolean;
    /**
     * Grant the strict `transitionTasks`/`rankTasks` capabilities (`/api/capabilities`), which
     * the canonical state control and board drag require. Off by default for the specs that
     * share this fixture.
     */
    workflowCapabilities?: boolean;
    /** Serve the 200-item `BRD` board project (see `BOARD_PROJECT_KEY`). */
    boardProject?: boolean;
  } = {},
) {
  let isAuthenticated = authenticated;
  let createdItem: ReturnType<typeof makeWorkItem> | undefined;
  // Mutable canonical rows: the WLP-1 detail and the BRD board persist their writes, so a
  // refetch (or reload) shows what was written, as the API would.
  const detailItem: Record<string, unknown> = {
    ...makeDetailItem(),
    assigneeActive: null,
    assigneeOnProject: null,
  };
  const detailComments: Array<Record<string, unknown>> = [];
  const boardItems = new Map(
    Array.from({ length: BOARD_ITEM_COUNT }, (_, index) => {
      const item = makeBoardItem(index + 1);
      return [item.key, item] as const;
    }),
  );
  const pendingBoardDeletions = new Map<string, string>();
  // Every request is a new pending action, as the API issues after a cancelled one.
  let pendingDeletionCount = 0;
  const cancelledDeletions = new Set<string>();
  const deletedBoardKeys = new Set<string>();
  const boardRows = () =>
    [...boardItems.values()]
      .filter((item) => !deletedBoardKeys.has(item.key))
      .sort(
        (left, right) =>
          BOARD_STATES.findIndex((state) => state.id === left.stateId) -
            BOARD_STATES.findIndex((state) => state.id === right.stateId) ||
          Number(left.position) - Number(right.position),
      );
  const deletedLegacyTaskIds = new Set<string>();
  let legacyTaskStatus = "backlog";
  let legacyTaskAssignee: string | null = null;
  const legacyComments: Array<Record<string, unknown>> = [];
  const initialBoardTasks = makeBoardProject().columns.flatMap(
    (column) => column.tasks,
  );
  const taskStore = createVersionedTaskFixture(initialBoardTasks, {
    assignableUserIds: [SESSION.user.id],
  });

  const legacyTask = () => ({
    ...(taskStore.getTask("legacy-task-1") ??
      makeBoardProject().columns[0].tasks[0]),
    status: legacyTaskStatus,
    columnId:
      makeBoardProject().columns.find(
        (column) => column.slug === legacyTaskStatus,
      )?.id ?? "backlog",
    userId: legacyTaskAssignee,
    assigneeId: legacyTaskAssignee,
    assigneeName: legacyTaskAssignee ? SESSION.user.name : null,
  });

  await page.routeWebSocket(/\/api\/ws\/project-g11(?:\?|$)/, (socket) => {
    socket.onMessage((message) => {
      if (typeof message === "string" && message.includes('"type":"ping"'))
        socket.send(JSON.stringify({ type: "pong" }));
    });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers":
            "Content-Type, X-TaskDesk-Window-Id, X-TaskDesk-CSRF, If-Match",
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        },
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "http://127.0.0.1:4178",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers":
            "Content-Type, X-TaskDesk-Window-Id, X-TaskDesk-CSRF, If-Match",
          "Access-Control-Allow-Methods":
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        },
      });

    const versionedTaskReply = taskStore.handle(request);
    if (versionedTaskReply)
      return json(versionedTaskReply.body, versionedTaskReply.status);

    if (
      dataDelayMs > 0 &&
      request.method() === "GET" &&
      !path.endsWith("/get-session")
    )
      await new Promise((resolve) => setTimeout(resolve, dataDelayMs));

    if (path.endsWith("/auth/get-session"))
      return json(isAuthenticated ? SESSION : null);
    if (path === "/api/me/security/factors" && request.method() === "GET")
      return isAuthenticated
        ? json({
            enabled: false,
            required: false,
            policyMode: "optional",
            availableMethods: ["password"],
          })
        : json({ message: "Unauthorized" }, 401);
    if (path === "/api/me/csrf-token" && request.method() === "GET")
      return isAuthenticated
        ? json({
            token: "g11-performance-csrf-token",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          })
        : json({ message: "Unauthorized" }, 401);
    if (path.endsWith("/auth/sign-in/email") && request.method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      isAuthenticated = true;
      return json({ token: "g11", user: SESSION.user });
    }
    if (path === "/api/config")
      return json({
        disableRegistration: false,
        disablePasswordRegistration: false,
        disableEmailOtpSignIn: true,
        disableWorkspaceCreation: false,
        hasSmtp: false,
        hasGithubSignIn: false,
        hasGoogleSignIn: false,
        hasDiscordSignIn: false,
        hasCustomOAuth: false,
        disableLoginForm: false,
        customOAuthAutoLogin: false,
        customOAuthLogoutUrl: null,
      });
    if (path === "/api/workspace" && request.method() === "GET")
      return json([
        {
          id: WORKSPACE_ID,
          name: "Performance workspace",
          slug: "performance",
          logo: null,
          description: null,
          createdAt: "2026-09-30T00:00:00.000Z",
        },
      ]);
    if (path === "/api/project" && request.method() === "GET")
      return json(boardProject ? [PROJECT, BOARD_PROJECT] : [PROJECT]);
    if (path === `/api/project/${PROJECT_ID}` && request.method() === "GET")
      return json(PROJECT);
    if (
      boardProject &&
      path === `/api/project/${BOARD_PROJECT_ID}` &&
      request.method() === "GET"
    )
      return json(BOARD_PROJECT);
    if (
      boardProject &&
      path === `/api/projects/${BOARD_PROJECT_ID}/states` &&
      request.method() === "GET"
    )
      return json(
        BOARD_STATES.map((state, index) => ({
          id: state.id,
          stateTemplateId: `template-${state.id}`,
          name: state.name,
          group: state.group,
          position: index + 1,
          isDefault: index === 0,
        })),
      );
    if (
      path === `/api/projects/${PROJECT_ID}/states` &&
      request.method() === "GET"
    )
      return json([
        {
          id: "state-g11",
          stateTemplateId: "template-g11",
          name: "Backlog",
          group: "backlog",
          position: 1,
          isDefault: true,
        },
      ]);
    if (path === "/api/capabilities")
      return json({
        manageProjects: false,
        manageProjectSettings: false,
        createProjects: false,
        updateProjects: false,
        deleteProjects: false,
        updateTasks: true,
        createTasks: true,
        deleteTasks: true,
        assignTasks: true,
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
        ...(workflowCapabilities
          ? { transitionTasks: true, rankTasks: true }
          : {}),
      });
    if (path === `/api/workspace/${WORKSPACE_ID}/work-item-types`)
      return json([{ id: TYPE_ID, key: "task", name: "Task" }]);
    if (
      path === `/api/workspace/${WORKSPACE_ID}/members` &&
      request.method() === "GET"
    )
      return json([
        {
          id: SESSION.user.id,
          name: SESSION.user.name,
          email: SESSION.user.email,
          image: null,
          role: "owner",
        },
      ]);
    if (
      path === `/api/label/workspace/${WORKSPACE_ID}` &&
      request.method() === "GET"
    )
      return json([]);
    if (path === `/api/task/tasks/${PROJECT_ID}` && request.method() === "GET")
      return json({
        data: makeBoardProject(deletedLegacyTaskIds, taskStore),
        pagination: {
          total: 200,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        },
      });
    if (path === `/api/task/${"legacy-task-1"}` && request.method() === "GET")
      return json(legacyTask());
    if (path === `/api/column/${PROJECT_ID}` && request.method() === "GET")
      return json(
        makeBoardProject(new Set(), taskStore).columns.map(
          ({ id, name, slug, isFinal, icon, color, position }) => ({
            id,
            name,
            slug,
            isFinal,
            icon,
            color,
            position,
          }),
        ),
      );
    if (
      path === `/api/activity/${"legacy-task-1"}` &&
      request.method() === "GET"
    )
      return json(legacyComments);
    if (path === "/api/activity/comment" && request.method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const body = request.postDataJSON() as {
        comment: string;
        taskId: string;
      };
      const comment = {
        id: `g11-comment-${legacyComments.length + 1}`,
        type: "comment",
        content: body.comment,
        createdAt: new Date().toISOString(),
        userId: SESSION.user.id,
        taskId: body.taskId,
      };
      legacyComments.push(comment);
      return json(comment);
    }
    if (
      path === "/api/task/status/legacy-task-1" &&
      request.method() === "PUT"
    ) {
      legacyTaskStatus = String(request.postDataJSON().status);
      return json(legacyTask());
    }
    if (
      path === "/api/task/assignee/legacy-task-1" &&
      request.method() === "PUT"
    ) {
      legacyTaskAssignee = String(request.postDataJSON().userId || "") || null;
      return json(legacyTask());
    }
    if (path.startsWith("/api/task/") && request.method() === "DELETE") {
      const id = path.split("/").at(-1) ?? "";
      deletedLegacyTaskIds.add(id);
      return json({ id, projectId: PROJECT_ID });
    }
    if (path.startsWith("/api/task/") && request.method() === "PUT")
      return json({ id: path.split("/").at(-1), ...request.postDataJSON() });
    if (
      path === `/api/projects/${PROJECT_ID}/work-items` &&
      request.method() === "GET"
    )
      return json({
        data: createdItem ? [...SEEDED_ITEMS, createdItem] : SEEDED_ITEMS,
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    if (
      path === `/api/projects/${PROJECT_ID}/work-items` &&
      request.method() === "POST"
    ) {
      // Keep the mocked mutation pending long enough for the browser to paint the
      // genuine busy state before the response resolves under a zero-latency route stub.
      await new Promise((resolve) => setTimeout(resolve, 250));
      createdItem = {
        ...makeWorkItem(501),
        title: String(request.postDataJSON().title),
      };
      return json(createdItem);
    }
    if (
      path === `/api/work-items/${WORK_ITEM_KEY}` &&
      request.method() === "GET"
    )
      return json(detailItem);

    // Canonical work-item writes (detail state/assignee/comment, board move and delete).
    const itemWrite = path.match(
      /^\/api\/work-items\/([A-Z]+-\d+)(?:\/(.+))?$/,
    );
    if (itemWrite) {
      const [, key, action] = itemWrite;
      const boardItem = boardProject ? boardItems.get(key) : undefined;
      const row =
        key === WORK_ITEM_KEY
          ? detailItem
          : boardItem && !deletedBoardKeys.has(key)
            ? boardItem
            : undefined;
      const method = request.method();
      if (boardItem && row && action === undefined && method === "GET")
        return json(row);
      if (row && action === "transitions" && method === "GET")
        return json(
          boardItem
            ? BOARD_STATES.filter((state) => state.id !== row.stateId).map(
                transitionOffer,
              )
            : row.stateId === DETAIL_PROGRESS_STATE.id
              ? []
              : [transitionOffer(DETAIL_PROGRESS_STATE)],
        );
      if (row && action === "transition" && method === "POST") {
        const target = [...BOARD_STATES, DETAIL_PROGRESS_STATE].find(
          (state) =>
            `template-${state.id}` ===
            String(request.postDataJSON().toStateTemplateId),
        );
        if (!target) return json({ message: "No such transition" }, 409);
        Object.assign(row, {
          stateId: target.id,
          stateName: target.name,
          stateCategory: target.group,
          version: Number(row.version) + 1,
        });
        return json({
          key,
          stateId: row.stateId,
          assigneeId: row.assigneeId,
          resolvedAt: null,
          version: row.version,
        });
      }
      if (boardItem && row && action === "rank" && method === "POST") {
        const { beforeId, afterId } = request.postDataJSON() as {
          beforeId?: string;
          afterId?: string;
        };
        const position = (id: string | undefined) =>
          Number(
            [...boardItems.values()].find((item) => item.id === id)?.position,
          );
        const before = position(beforeId);
        const after = position(afterId);
        boardItem.position = (
          Number.isFinite(before) && Number.isFinite(after)
            ? (before + after) / 2
            : Number.isFinite(after)
              ? after - 0.5
              : before + 0.5
        ).toFixed(10);
        return json({ key, position: boardItem.position });
      }
      if (row === detailItem && action === "assign" && method === "POST") {
        const { assigneeId } = request.postDataJSON() as {
          assigneeId: string;
        };
        const previousAssigneeId = detailItem.assigneeId ?? null;
        Object.assign(detailItem, {
          assigneeId,
          assigneeName: ASSIGNABLE_PERSON.name,
          assigneeActive: true,
          assigneeOnProject: true,
          version: Number(detailItem.version) + 1,
        });
        return json({
          key,
          assigneeId,
          previousAssigneeId,
          version: detailItem.version,
        });
      }
      if (row === detailItem && action === "comments" && method === "POST") {
        // Pending long enough for the browser to paint the genuine sending state.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const { body, visibility } = request.postDataJSON() as {
          body: unknown;
          visibility: string;
        };
        const now = new Date().toISOString();
        const comment = {
          id: `g11-comment-${detailComments.length + 1}`,
          workItemId: String(detailItem.id),
          workspaceId: WORKSPACE_ID,
          authorId: ASSIGNABLE_PERSON.personId,
          actorType: "person",
          body,
          visibility,
          activityId: null,
          editedAt: null,
          deletedAt: null,
          deletedBy: null,
          createdAt: now,
          updatedAt: now,
        };
        detailComments.push(comment);
        return json(comment);
      }
      if (row === detailItem && action === "activity" && method === "GET")
        return json({
          data: detailComments.map((comment) => ({
            ...comment,
            kind: "comment",
            actorId: comment.authorId,
            actorPersonId: comment.authorId,
            actorDisplayName: ASSIGNABLE_PERSON.name,
            verb: "commented",
            field: null,
            oldValue: null,
            newValue: null,
            payload: null,
            workflowVersionId: null,
            canEdit: true,
            canDelete: true,
          })),
          page: { nextCursor: null, hasMore: false },
        });
      if (boardItem && row && action === undefined && method === "DELETE") {
        // P0: a delete is a request that opens a pending action; nothing is removed yet.
        const pendingActionId = `pending-g11-delete-${key}-${++pendingDeletionCount}`;
        pendingBoardDeletions.set(pendingActionId, key);
        return json(
          {
            pendingActionId,
            action: "delete",
            summary: { key, title: boardItem.title },
            confirmation: "click",
            expiresAt: "2026-12-31T00:00:00.000Z",
            approveUrl: `/api/me/pending-actions/${pendingActionId}/approve`,
          },
          202,
        );
      }
    }
    const pendingAction = path.match(
      /^\/api\/me\/pending-actions\/(pending-g11-delete-[A-Za-z0-9-]+?)(?:\/(approve|cancel))?$/,
    );
    if (pendingAction && pendingBoardDeletions.has(pendingAction[1])) {
      const [, pendingActionId, decision] = pendingAction;
      const key = pendingBoardDeletions.get(pendingActionId) ?? "";
      if (decision === "approve" && request.method() === "POST") {
        deletedBoardKeys.add(key);
        return json({ id: pendingActionId, state: "executed" });
      }
      if (decision === "cancel" && request.method() === "POST") {
        cancelledDeletions.add(pendingActionId);
        return json({});
      }
      if (decision === undefined && request.method() === "GET")
        return json({
          id: pendingActionId,
          action: "delete",
          origin: "web",
          targetType: "work_item",
          targetIds: [key],
          summary: { key, title: boardItems.get(key)?.title ?? key },
          confirmation: "click",
          approvalSupported: true,
          state: cancelledDeletions.has(pendingActionId)
            ? "cancelled"
            : deletedBoardKeys.has(key)
              ? "executed"
              : "pending",
          createdAt: "2026-09-30T00:00:00.000Z",
          expiresAt: "2026-12-31T00:00:00.000Z",
          invalidationReason: null,
          decidedAt: null,
          executedAt: null,
          requestingKeyName: null,
        });
    }
    if (
      boardProject &&
      path === `/api/projects/${BOARD_PROJECT_ID}/work-items` &&
      request.method() === "GET"
    )
      return json({
        data: boardRows(),
        page: { hasMore: false, nextCursor: null },
        meta: {},
      });
    if (
      boardProject &&
      path === `/api/projects/${BOARD_PROJECT_KEY}/wip-limits` &&
      request.method() === "GET"
    )
      return json({ data: [], canManage: false });
    if (
      (path === `/api/projects/${PROJECT_ID}/assignable` ||
        (boardProject &&
          path === `/api/projects/${BOARD_PROJECT_ID}/assignable`)) &&
      request.method() === "GET"
    )
      return json([ASSIGNABLE_PERSON]);

    if (
      path === `/api/work-items/${WORK_ITEM_KEY}/labels` &&
      request.method() === "GET"
    )
      return json([]);

    // Shell reads every authenticated agent screen makes since P0–P6. An unanswered read
    // fails (and retries) instead of rendering the empty state a fresh deployment shows.
    if (request.method() === "GET") {
      if (
        path === "/api/public/terminology" ||
        path === `/api/workspaces/${WORKSPACE_ID}/terminology/runtime`
      )
        return json({
          locale: url.searchParams.get("locale") ?? "en-US",
          audience: "agent",
          terms: {},
          etag: '"g11-terminology"',
        });
      if (path === "/api/me/settings") return json({ settings: {} });
      if (
        path === "/api/features/resolved" ||
        path === `/api/workspaces/${WORKSPACE_ID}/features/resolved`
      )
        return json({ features: DEFAULT_RESOLVED_FEATURES });
      if (path === "/api/notification/inbox")
        return json({
          data: [],
          unreadCount: 0,
          hasMore: false,
          nextCursor: null,
        });
      if (path === "/api/invitation/pending") return json([]);
      if (path === "/api/views") return json([]);
      if (path === "/api/custom-fields")
        return json({
          data: [],
          meta: { total: 0, manyFieldsWarning: false },
        });
      if (path === `/api/projects/${PROJECT_KEY}/wip-limits`)
        return json({ data: [], canManage: false });
      if (path === "/api/service-catalogue/status")
        return json({
          enabled: false,
          canManageServices: false,
          canManageChanges: false,
          canManageReleases: false,
        });
      // Sections of the work-item detail (page and side pane) for a seeded item
      // with no relations, files, activity, approvals or children yet.
      const detailRead = path.match(
        /^\/api\/work-items\/(WLP-(\d+))\/([a-z-]+(?:\/[a-z-]+)?)$/,
      );
      if (detailRead) {
        const [, , number, section] = detailRead;
        if (section === "relations") return json({ data: [], hiddenCount: 0 });
        if (section === "attachments") return json([]);
        if (section === "activity")
          return json({
            data: [],
            page: { nextCursor: null, hasMore: false },
          });
        if (section === "comments/mention-candidates") return json([]);
        if (section === "approvals") return json({ approvals: [] });
        if (section === "approval-request-context")
          return json({
            enabled: true,
            canRequestCustomer: false,
            canRequestCab: false,
            defaultExpiryDays: 7,
            maxExpiryDays: 90,
            transitions: [],
          });
        if (section === "children")
          return json({
            parent: makeWorkItem(Number(number)),
            ancestors: [],
            data: [],
            page: { nextCursor: null, hasMore: false },
            meta: { total: 0 },
            progress: { completed: 0, total: 0 },
          });
      }
      if (path === "/api/canned-responses") return json([]);
      // The create dialog's reads: no live templates, an empty project label catalogue.
      if (path === `/api/workspace/${WORKSPACE_ID}/work-item-templates`)
        return json([]);
      if (/^\/api\/label\/project\/[^/]+\/catalogue$/.test(path))
        return json([]);
    }

    return json({ message: "Not found in the G11 browser fixture" }, 404);
  });

  await page.addInitScript((observeG13Windows: boolean) => {
    const metrics: BrowserMetrics = {
      lcp: 0,
      cls: 0,
      interactionStart: 0,
      interactionPaint: 0,
      routeStart: 0,
      routePaint: 0,
      documentStart: performance.now(),
      listPaint: 0,
      boardPaint: 0,
      signInStart: 0,
      signInPaint: 0,
      paletteStart: 0,
      paletteInsert: 0,
      palettePaint: 0,
      paletteNavigationStart: 0,
      paletteNavigationPaint: 0,
      stateStart: 0,
      statePaint: 0,
      assignmentStart: 0,
      assignmentPaint: 0,
      commentStart: 0,
      commentPaint: 0,
      g13: {
        "work-list": {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        detail: {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        board: {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        "legacy-task": {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        projects: {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        "sign-in": {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
        "red-probe": {
          skeletonMark: 0,
          contentMark: 0,
          cls: 0,
          skeletonPending: false,
          contentPending: false,
          inputShiftCount: 0,
        },
      },
      lcpElement: "",
      lcpText: "",
      lcpUrl: "",
    };
    Object.defineProperty(window, "__g11Metrics", {
      value: metrics,
      configurable: true,
    });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const lcp = entry as PerformanceEntry & {
          element?: Element | null;
          url?: string;
        };
        metrics.lcp = lcp.startTime;
        metrics.lcpElement = lcp.element
          ? `${lcp.element.tagName.toLowerCase()}${lcp.element.id ? `#${lcp.element.id}` : ""}${lcp.element.classList.length ? `.${Array.from(lcp.element.classList).slice(0, 3).join(".")}` : ""}`
          : "(no element)";
        metrics.lcpText = lcp.element?.textContent?.trim().slice(0, 160) ?? "";
        metrics.lcpUrl = lcp.url ?? "";
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    const layoutShiftEntries: Array<{
      startTime: number;
      value: number;
      hadRecentInput: boolean;
    }> = [];
    const collectLayoutShiftEntries = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value: number;
        };
        const hadRecentInput = shift.hadRecentInput ?? false;
        if (!hadRecentInput) metrics.cls += shift.value;
        layoutShiftEntries.push({
          startTime: shift.startTime,
          value: shift.value,
          hadRecentInput,
        });
      }
    };
    const layoutShiftObserver = new PerformanceObserver((list) =>
      collectLayoutShiftEntries(list.getEntries()),
    );
    layoutShiftObserver.observe({ type: "layout-shift", buffered: true });

    const transitions = [
      {
        name: "work-list",
        skeleton: '[data-testid="work-item-list-loading"]',
        content: '[data-testid="work-item-list-populated"]',
      },
      {
        name: "detail",
        skeleton: '[data-testid="work-item-detail-loading"]',
        content: '[data-testid="work-item-detail"]',
      },
      // The canonical work-item board replaced the legacy board.
      {
        name: "board",
        skeleton: '[data-testid="work-item-board-loading"]',
        content: '[data-testid="work-item-board"]',
      },
      // An old legacy task link: its loading skeleton, then (after the redirect) the
      // canonical work-item detail that replaced the legacy task page.
      {
        name: "legacy-task",
        skeleton: '[data-testid="g13-legacy-task-loading"]',
        content: '[data-testid="work-item-detail"]',
      },
      {
        name: "projects",
        skeleton: '[data-testid="workspace-projects-route-pending"]',
        content: '[data-testid="g13-projects-content"]',
      },
      {
        name: "sign-in",
        skeleton: '[data-testid="g13-sign-in-loading"]',
        content: '[data-testid="g13-sign-in-content"]',
      },
      {
        name: "red-probe",
        skeleton: '[data-testid="g13-red-probe-loading"]',
        content: '[data-testid="g13-red-probe-content"]',
      },
    ] as const;
    const isVisible = (selector: string) => {
      const element = document.querySelector(selector);
      return Boolean(element?.isConnected && element.getClientRects().length);
    };
    const recordTransitions = () => {
      for (const transition of transitions) {
        const measurement = metrics.g13[transition.name];
        if (
          measurement.skeletonMark === 0 &&
          !measurement.skeletonPending &&
          isVisible(transition.skeleton)
        ) {
          measurement.skeletonPending = true;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (!isVisible(transition.skeleton)) {
                measurement.skeletonPending = false;
                return;
              }
              measurement.skeletonMark = performance.now();
              performance.mark(
                `taskdesk:g13:${transition.name}:skeleton-mounted`,
              );
              recordTransitions();
            }),
          );
        }
        if (
          measurement.skeletonMark === 0 ||
          measurement.contentMark > 0 ||
          measurement.contentPending ||
          !isVisible(transition.content)
        )
          continue;

        measurement.contentPending = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!isVisible(transition.content)) {
              measurement.contentPending = false;
              return;
            }
            measurement.contentMark = performance.now();
            performance.mark(`taskdesk:g13:${transition.name}:content-mounted`);
            const { skeletonMark, contentMark } = measurement;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                collectLayoutShiftEntries(layoutShiftObserver.takeRecords());
                const windowEntries = layoutShiftEntries.filter(
                  (entry) =>
                    entry.startTime >= skeletonMark &&
                    entry.startTime <= contentMark,
                );
                measurement.cls = windowEntries.reduce(
                  (total, entry) => total + entry.value,
                  0,
                );
                measurement.inputShiftCount = windowEntries.filter(
                  (entry) => entry.hadRecentInput,
                ).length;
              }),
            );
          }),
        );
      }
    };
    const attachG13Observer = () => {
      if (!document.documentElement) {
        document.addEventListener("DOMContentLoaded", attachG13Observer, {
          once: true,
        });
        return;
      }
      const g13Observer = new MutationObserver(recordTransitions);
      g13Observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      recordTransitions();
    };
    if (observeG13Windows) attachG13Observer();

    const responseIsVisible = (kind: "interaction" | "route") => {
      if (kind === "interaction") {
        return (
          (document.querySelector(
            '[data-testid="create-work-item-submit"][aria-busy="true"]',
          ) as HTMLButtonElement | null) !== null
        );
      }
      return (
        document.querySelector(
          '[data-testid="work-item-detail-loading"], [data-testid="work-item-detail"]',
        ) !== null
      );
    };
    const paintPending = { interaction: false, route: false };
    const recordAfterPaint = (kind: "interaction" | "route") => {
      const start =
        kind === "interaction" ? metrics.interactionStart : metrics.routeStart;
      const paint =
        kind === "interaction" ? metrics.interactionPaint : metrics.routePaint;
      if (
        start <= 0 ||
        paint > 0 ||
        paintPending[kind] ||
        !responseIsVisible(kind)
      )
        return;
      paintPending[kind] = true;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!responseIsVisible(kind)) {
            paintPending[kind] = false;
            return;
          }
          const elapsed = performance.now() - start;
          if (kind === "interaction") metrics.interactionPaint = elapsed;
          else metrics.routePaint = elapsed;
        }),
      );
    };
    const watchForPaint = (kind: "interaction" | "route") => {
      const poll = () => {
        const paint =
          kind === "interaction"
            ? metrics.interactionPaint
            : metrics.routePaint;
        if (paint > 0) return;
        recordAfterPaint(kind);
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    };
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        const button = target?.closest("button");
        const label = button?.textContent?.trim();
        if (label === "Create") {
          metrics.interactionStart = performance.now();
          watchForPaint("interaction");
        }
        if (label === "Sign In") {
          metrics.signInStart = performance.now();
          const submitButton = button as HTMLButtonElement | null;
          if (!submitButton) return;
          const record = () => {
            if (!submitButton.disabled) {
              requestAnimationFrame(record);
              return;
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                metrics.signInPaint = performance.now() - metrics.signInStart;
              }),
            );
          };
          requestAnimationFrame(record);
        }
        if (label?.startsWith("In progress")) {
          metrics.stateStart = performance.now();
          const record = () => {
            const matchingButtons = Array.from(
              document.querySelectorAll("button"),
            ).filter(
              (element) =>
                element.textContent?.trim() === "In progress" &&
                !element.closest('[data-slot="popover-popup"]') &&
                element.getClientRects().length > 0,
            );
            if (matchingButtons.length !== 1) {
              requestAnimationFrame(record);
              return;
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                metrics.statePaint = performance.now() - metrics.stateStart;
              }),
            );
          };
          requestAnimationFrame(record);
        }
        if (label?.includes("G11 Agent")) {
          metrics.assignmentStart = performance.now();
          const record = () => {
            const matchingButtons = Array.from(
              document.querySelectorAll("button"),
            ).filter(
              (element) =>
                element.textContent?.includes("G11 Agent") &&
                !element.closest('[data-slot="popover-popup"]') &&
                element.getClientRects().length > 0,
            );
            if (matchingButtons.length !== 1) {
              requestAnimationFrame(record);
              return;
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                metrics.assignmentPaint =
                  performance.now() - metrics.assignmentStart;
              }),
            );
          };
          requestAnimationFrame(record);
        }
        // The canonical composer's send button: the one control in it carrying `aria-busy`.
        if (
          button?.hasAttribute("aria-busy") &&
          button.closest('[data-testid="work-item-comment-composer"]')
        ) {
          metrics.commentStart = performance.now();
          const record = () => {
            const submit = document.querySelector(
              '[data-testid="work-item-comment-composer"] button[aria-busy="true"]',
            );
            if (!submit) {
              requestAnimationFrame(record);
              return;
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                metrics.commentPaint = performance.now() - metrics.commentStart;
              }),
            );
          };
          requestAnimationFrame(record);
        }
        if (
          target
            ?.closest("a[href]")
            ?.getAttribute("href")
            ?.includes("/agent/work-items/" + "WLP-1")
        ) {
          metrics.routeStart = performance.now();
          watchForPaint("route");
        }
      },
      { capture: true },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          document.querySelector('[role="dialog"]') &&
          metrics.paletteNavigationStart === 0
        ) {
          metrics.paletteNavigationStart = performance.now();
          const recordDestinationPaint = () => {
            const destinationReady =
              location.pathname.replace(/\/+$/, "") ===
                "/dashboard/workspace/ws-g11" &&
              Boolean(
                document
                  .querySelector(
                    '[data-testid="workspace-projects-route-pending"]',
                  )
                  ?.getClientRects().length,
              );
            if (!destinationReady) {
              requestAnimationFrame(recordDestinationPaint);
              return;
            }
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const stillReady =
                  location.pathname.replace(/\/+$/, "") ===
                    "/dashboard/workspace/ws-g11" &&
                  Boolean(
                    document
                      .querySelector(
                        '[data-testid="workspace-projects-route-pending"]',
                      )
                      ?.getClientRects().length,
                  );
                if (stillReady)
                  metrics.paletteNavigationPaint =
                    performance.now() - metrics.paletteNavigationStart;
              }),
            );
          };
          requestAnimationFrame(recordDestinationPaint);
        }
        if (
          !(event.ctrlKey || event.metaKey) ||
          event.key.toLowerCase() !== "k"
        )
          return;
        metrics.paletteStart = performance.now();
        const record = () => {
          if (!document.querySelector('[role="dialog"]')) {
            requestAnimationFrame(record);
            return;
          }
          metrics.paletteInsert = performance.now() - metrics.paletteStart;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              metrics.palettePaint = performance.now() - metrics.paletteStart;
            }),
          );
        };
        requestAnimationFrame(record);
      },
      { capture: true },
    );
  }, g13Windows);

  return () => {
    createdItem = undefined;
  };
}
