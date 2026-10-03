import { mkdir } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import {
  median,
  medianOfThreeWithRetry,
} from "../../../scripts/ci/lib/performance-budget.mjs";
import { installLastItemPaintRecorder } from "./helpers/last-item-paint-recorder";
import { attachPerformanceNetworkCapture } from "./helpers/performance-network-summary";
import { createVersionedTaskFixture } from "./helpers/versioned-task-fixture";

const G13_TRANSITIONS = [
  "work-list",
  "detail",
  "board",
  "legacy-task",
  "projects",
  "sign-in",
  "red-probe",
] as const;

type G13Transition = (typeof G13_TRANSITIONS)[number];

type G13WindowMetric = {
  skeletonMark: number;
  contentMark: number;
  cls: number;
  skeletonPending: boolean;
  contentPending: boolean;
  inputShiftCount: number;
};

type BrowserMetrics = {
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

type G11Window = Window & { __g11Metrics: BrowserMetrics };

type BudgetMetric = {
  name: string;
  budget: number;
  sample: () => Promise<number>;
};

const WORK_LIST_PATH = "/agent/projects/WLP/work?layout=list";
const PERFORMANCE_BASE_URL = "http://127.0.0.1:4178";
const WORK_ITEM_KEY = "WLP-1";
const WORKSPACE_ID = "ws-g11";
const PROJECT_ID = "project-g11";
const TYPE_ID = "type-g11";
const SCREENSHOT_DIR = "test-results/g11-screens";
let networkAttachmentSequence = 0;

async function captureScreen(page: Page, name: string) {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

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

function makeWorkItem(number: number) {
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

async function installPerformanceApiFixture(
  page: Page,
  {
    authenticated = true,
    dataDelayMs = 0,
    g13Windows = false,
  }: {
    authenticated?: boolean;
    dataDelayMs?: number;
    g13Windows?: boolean;
  } = {},
) {
  let isAuthenticated = authenticated;
  let createdItem: ReturnType<typeof makeWorkItem> | undefined;
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
            "Content-Type, X-TaskDesk-Window-Id, If-Match",
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
            "Content-Type, X-TaskDesk-Window-Id, If-Match",
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
      return json([PROJECT]);
    if (path === `/api/project/${PROJECT_ID}` && request.method() === "GET")
      return json(PROJECT);
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
      return json(makeDetailItem());

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
      {
        name: "board",
        skeleton: '[data-testid="g13-board-loading"]',
        content: '[data-testid="g13-board-content"]',
      },
      {
        name: "legacy-task",
        skeleton: '[data-testid="g13-legacy-task-loading"]',
        content: '[data-testid="g13-legacy-task-content"]',
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
        if (button?.dataset.testid === "comment-submit") {
          metrics.commentStart = performance.now();
          const record = () => {
            const submit = document.querySelector(
              '[data-testid="comment-submit"][aria-busy="true"]',
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

async function installFast4gAndCpuThrottle(page: Page) {
  // Leave the current application document before changing the network profile.
  // Chromium reports ERR_NETWORK_CHANGED for asset requests that were in flight
  // on the existing Vite page when emulateNetworkConditions is applied.
  await page.goto("about:blank");
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 93_750,
    connectionType: "cellular4g",
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return session;
}

async function withPerformancePage(
  browser: Browser,
  throttled: boolean,
  sample: (page: Page, resetFixture: () => void) => Promise<number>,
  fixtureOptions?: {
    authenticated?: boolean;
    dataDelayMs?: number;
    g13Windows?: boolean;
  },
) {
  const context = await browser.newContext({
    baseURL: PERFORMANCE_BASE_URL,
    viewport: { width: 1280, height: 720 },
  });
  const networkCapture = attachPerformanceNetworkCapture(
    context,
    PERFORMANCE_BASE_URL,
  );
  let session:
    | Awaited<ReturnType<typeof installFast4gAndCpuThrottle>>
    | undefined;
  let sampleOutcome:
    | { status: "success"; value: number }
    | { status: "failure"; error: unknown }
    | undefined;

  try {
    const page = await context.newPage();
    const resetFixture = await installPerformanceApiFixture(
      page,
      fixtureOptions,
    );
    if (throttled) session = await installFast4gAndCpuThrottle(page);
    sampleOutcome = {
      status: "success",
      value: await sample(page, resetFixture),
    };
  } catch (error) {
    sampleOutcome = { status: "failure", error };
  } finally {
    const cleanupErrors: unknown[] = [];
    if (session) {
      try {
        await session.detach();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await context.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    let networkSummary: string | undefined;
    try {
      networkSummary = networkCapture.finish();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (networkSummary !== undefined) {
      networkAttachmentSequence += 1;
      try {
        await test
          .info()
          .attach(`g11-network-sample-${networkAttachmentSequence}.json`, {
            body: networkSummary,
            contentType: "application/json",
          });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      if (sampleOutcome?.status === "failure") {
        sampleOutcome = {
          status: "failure",
          error: new AggregateError(
            [sampleOutcome.error, ...cleanupErrors],
            "G11 sample and evidence cleanup failed.",
          ),
        };
      } else {
        sampleOutcome = {
          status: "failure",
          error: new AggregateError(
            cleanupErrors,
            "G11 sample evidence cleanup failed.",
          ),
        };
      }
    }
  }
  if (sampleOutcome?.status === "failure") throw sampleOutcome.error;
  if (sampleOutcome === undefined)
    throw new Error("G11 sample did not produce an outcome.");
  return sampleOutcome.value;
}

async function waitForTwoFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function openWorkList(page: Page) {
  await page.goto(WORK_LIST_PATH);
  const rows = page.locator("[data-testid=work-item-list-populated] tbody tr");
  try {
    await expect(rows).toHaveCount(500, { timeout: 30_000 });
  } catch (error) {
    const [rowCount, tableCount, testIdCount, bodyText] = await Promise.all([
      rows.count(),
      page.getByRole("table").count(),
      page.getByTestId("work-item-list-populated").count(),
      page.locator("body").innerText(),
    ]);
    console.error(
      "G11 list fixture did not render 500 rows:",
      JSON.stringify({
        url: page.url(),
        rowCount,
        tableCount,
        testIdCount,
        bodyText: bodyText.slice(0, 1200),
      }),
    );
    throw error;
  }
}

async function collectNavigationMetric(page: Page, name: "lcp" | "cls") {
  await openWorkList(page);
  await waitForTwoFrames(page);
  const value = await page.evaluate(
    (requested) => (window as G11Window).__g11Metrics[requested],
    name,
  );
  if (name === "lcp") {
    const diagnostic = await page.evaluate(() => ({
      metrics: {
        lcp: (window as G11Window).__g11Metrics.lcp,
        element: (window as G11Window).__g11Metrics.lcpElement,
        text: (window as G11Window).__g11Metrics.lcpText,
        url: (window as G11Window).__g11Metrics.lcpUrl,
      },
      navigation: (() => {
        const entry = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        return entry
          ? {
              responseStart: entry.responseStart,
              domInteractive: entry.domInteractive,
              domContentLoaded: entry.domContentLoadedEventEnd,
              load: entry.loadEventEnd,
              domComplete: entry.domComplete,
            }
          : null;
      })(),
      lateResources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter(
          (entry) =>
            entry.name.includes("/assets/") || entry.name.includes("/api/"),
        )
        .sort((a, b) => b.responseEnd - a.responseEnd)
        .slice(0, 12)
        .map((entry) => ({
          url: entry.name.split("/").slice(-1)[0],
          initiator: entry.initiatorType,
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transfer: entry.transferSize,
        })),
      criticalResources: performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter((entry) =>
          /en-US-|agent-initial-runtime|work-[\w-]+\.js|geist-latin-wght-normal/.test(
            entry.name,
          ),
        )
        .map((entry) => ({
          url: entry.name.split("/").slice(-1)[0],
          start: Math.round(entry.startTime),
          end: Math.round(entry.responseEnd),
          duration: Math.round(entry.duration),
          transfer: entry.transferSize,
        }))
        .sort((left, right) => left.start - right.start),
    }));
    console.info("G11 LCP diagnostic", JSON.stringify(diagnostic));
  }
  if (name === "lcp" && value <= 0)
    throw new Error("The work-list navigation emitted no LCP entry.");
  if (name === "lcp") await captureScreen(page, "work-list");
  return value;
}

async function collectCreateInteraction(page: Page, resetFixture: () => void) {
  resetFixture();
  await openWorkList(page);
  await page.getByTestId("create-work-item-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await captureScreen(page, "create-dialog");
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Task" }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("G11 interaction sample");
  const createButton = page.getByTestId("create-work-item-submit");
  await createButton.click();
  await expect(createButton).toHaveAttribute("aria-busy", "true");
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.interactionPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.interactionPaint,
  );
  if (clickToPaint <= 0)
    throw new Error("The create submit click emitted no pending-state paint.");
  await expect(
    page.getByRole("link", { name: "G11 interaction sample" }),
  ).toBeVisible({ timeout: 15_000 });
  return clickToPaint;
}

async function collectSignInInteraction(page: Page) {
  await page.goto("/auth/sign-in");
  const email = page.getByLabel("Email", { exact: true });
  const password = page.locator('input[type="password"]');
  await email.fill("g11@example.test");
  await password.fill("correct-horse-battery-staple");
  const submit = page.locator('form button[type="submit"]');
  await captureScreen(page, "sign-in");
  await submit.click();
  await expect(submit).toBeDisabled();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.signInPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.signInPaint,
  );
  await expect(page).toHaveURL(/\/dashboard(?:\/|$)/, { timeout: 15_000 });
  return clickToPaint;
}

async function collectCommandPaletteInteraction(
  page: Page,
  metric: "open" | "navigate" = "open",
) {
  await openWorkList(page);
  const palettePopup = page.locator('[data-slot="command-dialog-popup"]');
  await expect(palettePopup).toHaveCount(1);
  await expect(palettePopup).toBeHidden();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+k" : "Control+k",
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder(/search/i)).toBeFocused();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.palettePaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.palettePaint,
  );
  const insertion = await page.evaluate(
    () => (window as G11Window).__g11Metrics.paletteInsert,
  );
  console.info(
    "G11 palette timing",
    JSON.stringify({ insertion, paint: clickToPaint }),
  );
  await captureScreen(page, "command-palette");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  const projectsOption = page.getByRole("option", { name: "Projects" });
  const projectsOptionId = await projectsOption.getAttribute("id");
  await expect(dialog.getByPlaceholder(/search/i)).toHaveAttribute(
    "aria-activedescendant",
    projectsOptionId ?? "",
  );
  await page.keyboard.press("Enter");
  const readNavigationPaint = async () => {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.paletteNavigationPaint > 0,
      undefined,
      { timeout: 15_000 },
    );
    return page.evaluate(
      () => (window as G11Window).__g11Metrics.paletteNavigationPaint,
    );
  };
  let navigationPaint =
    metric === "navigate" ? await readNavigationPaint() : null;
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/workspace/${WORKSPACE_ID}`),
  );
  await expect(
    page.getByRole("main").getByText("Performance fixture", { exact: true }),
  ).toBeVisible();
  await captureScreen(page, "projects-from-command-palette");
  navigationPaint ??= await readNavigationPaint();
  console.info("G11 palette navigation timing", navigationPaint);
  if (metric === "navigate") return navigationPaint;
  return clickToPaint;
}

async function openLegacyTaskDetails(page: Page) {
  await page.goto(
    `/dashboard/workspace/${WORKSPACE_ID}/project/${PROJECT_ID}/task/legacy-task-1`,
  );
  await expect(
    page.getByRole("button", { name: "Backlog", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

async function collectTaskStateChange(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-state");
  await page.getByRole("button", { name: "Backlog", exact: true }).click();
  await page
    .getByRole("button", { name: /^In progress/ })
    .last()
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.statePaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.statePaint,
  );
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "In progress",
    }),
  ).toBeVisible();
  return elapsed;
}

async function collectTaskAssignment(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-assignment");
  await page
    .getByRole("button", { name: /Unassigned/ })
    .last()
    .click();
  await page
    .getByRole("button", { name: /G11 Agent/ })
    .last()
    .click();
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.assignmentPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.assignmentPaint,
  );
  await expect(
    page.locator('[data-slot="popover-trigger"]:visible').filter({
      hasText: "G11 Agent",
    }),
  ).toBeVisible();
  return elapsed;
}

async function collectTaskComment(page: Page) {
  await openLegacyTaskDetails(page);
  await captureScreen(page, "legacy-task-comment");
  const editor = page
    .locator(".taskdesk-comment-editor-content [contenteditable=true]")
    .first();
  await editor.fill("G11 comment fixture");
  const submit = page.getByTestId("comment-submit");
  await submit.click();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.commentPaint > 0,
    undefined,
    { timeout: 15_000 },
  );
  const elapsed = await page.evaluate(
    () => (window as G11Window).__g11Metrics.commentPaint,
  );
  await expect(page.getByText("G11 comment fixture")).toBeVisible({
    timeout: 15_000,
  });
  return elapsed;
}

async function collectRouteTransition(page: Page) {
  await openWorkList(page);
  await page.getByRole("link", { name: WORK_ITEM_KEY, exact: true }).click();
  await expect(
    page.locator(
      '[data-testid="work-item-detail-loading"], [data-testid="work-item-detail"]',
    ),
  ).toBeVisible({ timeout: 15_000 });
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.routePaint > 0,
      undefined,
      { timeout: 15_000 },
    );
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      metrics: (window as G11Window).__g11Metrics,
      url: location.href,
      loading: !!document.querySelector(
        '[data-testid="work-item-detail-loading"]',
      ),
      detail: !!document.querySelector('[data-testid="work-item-detail"]'),
    }));
    throw new Error(
      `Timed out recording the route paint: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
  const clickToPaint = await page.evaluate(
    () => (window as G11Window).__g11Metrics.routePaint,
  );
  if (clickToPaint <= 0)
    throw new Error("The detail route emitted no loading/content paint.");
  await expect(page.getByTestId("work-item-detail")).toBeVisible({
    timeout: 15_000,
  });
  await captureScreen(page, "work-item-detail");
  return clickToPaint;
}

async function collectG13WindowCls(page: Page, transition: G13Transition) {
  await page.waitForFunction(
    (requested) =>
      (window as G11Window).__g11Metrics.g13[requested].contentMark > 0,
    transition,
    { timeout: 15_000 },
  );
  await waitForTwoFrames(page);
  const measurement = await page.evaluate(
    (requested) => (window as G11Window).__g11Metrics.g13[requested],
    transition,
  );
  expect(
    measurement.skeletonMark,
    `G13 requires the ${transition} loading skeleton to be observed before content`,
  ).toBeGreaterThan(0);
  expect(measurement.contentMark).toBeGreaterThan(measurement.skeletonMark);
  console.info(`G13 ${transition} skeleton-to-content CLS`, measurement);
  return measurement.cls;
}

async function collectG13WindowMeasurement(
  page: Page,
  transition: G13Transition,
) {
  await page.waitForFunction(
    (requested) =>
      (window as G11Window).__g11Metrics.g13[requested].contentMark > 0,
    transition,
    { timeout: 15_000 },
  );
  await waitForTwoFrames(page);
  return page.evaluate(
    (requested) => (window as G11Window).__g11Metrics.g13[requested],
    transition,
  );
}

async function collectListRender(page: Page) {
  const rowSelector = "[data-testid=work-item-list-populated] tbody tr";
  await installLastItemPaintRecorder(page, {
    kind: "list",
    expectedCount: 500,
    metric: "listPaint",
  });
  await page.goto(WORK_LIST_PATH);
  await expect(page.locator(rowSelector)).toHaveCount(500, {
    timeout: 30_000,
  });
  try {
    await page.waitForFunction(
      () => (window as G11Window).__g11Metrics.listPaint > 0,
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    console.error(
      "G11 list paint recorder diagnostics",
      JSON.stringify(
        await page.evaluate(() => ({
          metrics: (window as G11Window).__g11Metrics,
          recorder: (window as Window & { __g11PaintDebug?: unknown })
            .__g11PaintDebug,
          rows: document.querySelectorAll(
            "[data-testid=work-item-list-populated] tbody tr",
          ).length,
        })),
      ),
    );
    throw error;
  }
  await captureScreen(page, "work-list");
  return page.evaluate(
    () =>
      (window as G11Window).__g11Metrics.listPaint -
      (window as G11Window).__g11Metrics.documentStart,
  );
}

async function openLegacyBoard(page: Page) {
  await page.goto(
    "/dashboard/workspace/" +
      WORKSPACE_ID +
      "/project/" +
      PROJECT_ID +
      "/board",
  );
  await expect(
    page.getByText("Seeded legacy task 200", { exact: true }),
  ).toHaveCount(1, { timeout: 30_000 });
}

async function collectBoardRender(page: Page) {
  await installLastItemPaintRecorder(page, {
    kind: "board",
    expectedCount: 200,
    metric: "boardPaint",
  });
  await page.goto(
    "/dashboard/workspace/" +
      WORKSPACE_ID +
      "/project/" +
      PROJECT_ID +
      "/board",
  );
  await expect(
    page.getByText("Seeded legacy task 200", { exact: true }),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('[data-task-id^="legacy-task-"]')).toHaveCount(
    200,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => (window as G11Window).__g11Metrics.boardPaint > 0,
    undefined,
    { timeout: 10_000 },
  );
  await captureScreen(page, "board");
  return page.evaluate(
    () =>
      (window as G11Window).__g11Metrics.boardPaint -
      (window as G11Window).__g11Metrics.documentStart,
  );
}

async function collectBoardDragFrameP95(page: Page) {
  await openLegacyBoard(page);
  await page.waitForTimeout(400);

  let versionedWriteRequests = 0;
  const versionedWriteResults: Array<{
    taskId: string;
    ifMatch: string | undefined;
    status: number;
  }> = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname.match(/^\/api\/v2\/task\/[^/]+$/)
    ) {
      versionedWriteRequests += 1;
    }
  });
  page.on("response", (response) => {
    const request = response.request();
    if (
      request.method() === "PUT" &&
      new URL(response.url()).pathname.match(/^\/api\/v2\/task\/[^/]+$/)
    ) {
      const path = new URL(response.url()).pathname;
      versionedWriteResults.push({
        taskId: decodeURIComponent(path.slice("/api/v2/task/".length)),
        ifMatch: request.headers()["if-match"],
        status: response.status(),
      });
    }
  });

  const source = await page
    .getByText("Seeded legacy task 1", { exact: true })
    .boundingBox();
  const destination = await page
    .getByText("Seeded legacy task 51", { exact: true })
    .boundingBox();
  if (!source || !destination)
    throw new Error("The seeded board cards have no browser bounding boxes.");

  await page.evaluate(() => {
    const metrics = (window as G11Window).__g11Metrics;
    const frameTimes: number[] = [];
    metrics.dragFrameTimes = frameTimes;
    let previous: number | undefined;
    const stopAt = performance.now() + 2200;
    const sampleFrame = (now: number) => {
      if (previous !== undefined) frameTimes.push(now - previous);
      previous = now;
      if (now < stopAt) requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);
  });

  const fromX = source.x + source.width / 2;
  const fromY = source.y + source.height / 2;
  const toX = destination.x + destination.width / 2;
  const toY = destination.y + destination.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let step = 1; step <= 125; step += 1) {
    const progress = step / 125;
    await page.mouse.move(
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);

  const movedCardColumn = await page
    .locator('[data-task-id="legacy-task-1"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  const destinationCardColumn = await page
    .locator('[data-task-id="legacy-task-51"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  expect(movedCardColumn).toBe(destinationCardColumn);

  const frameTimes = await page.evaluate(
    () => (window as G11Window).__g11Metrics.dragFrameTimes ?? [],
  );
  if (frameTimes.length < 60)
    throw new Error(
      "The 2.2 second board drag captured too few animation frames: " +
        frameTimes.length,
    );
  const ordered = [...frameTimes].sort((left, right) => left - right);
  const frameP95 = ordered[Math.ceil(ordered.length * 0.95) - 1];

  expect(versionedWriteRequests).toBeGreaterThan(0);
  expect(versionedWriteResults).toHaveLength(versionedWriteRequests);
  expect(versionedWriteResults.every(({ status }) => status === 200)).toBe(
    true,
  );
  await page.reload();
  await expect(
    page.getByText("Seeded legacy task 1", { exact: true }),
  ).toHaveCount(1);
  const persistedTaskColumn = await page
    .locator('[data-task-id="legacy-task-1"]')
    .locator("xpath=ancestor::*[@data-column-id]")
    .getAttribute("data-column-id");
  expect(persistedTaskColumn).toBe("in-progress");
  console.info(
    "G11 board drag persisted versioned-write evidence",
    JSON.stringify({
      writes: versionedWriteResults,
      persistedTaskColumn,
    }),
  );
  return frameP95;
}

async function verifyBoardCardMenu(page: Page) {
  await openLegacyBoard(page);
  const card = page.getByText("Seeded legacy task 1", { exact: true });
  await card.click({ button: "right" });
  const copyLink = page.getByRole("menuitem", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  await captureScreen(page, "board-context-menu");
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  const keyboardCard = page.locator(
    '[data-task-id="legacy-task-1"] > [role="button"]',
  );
  await expect(keyboardCard).toHaveCount(1);
  await keyboardCard.focus();
  await expect(keyboardCard).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await expect(copyLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  await keyboardCard.focus();
  await page.keyboard.press("ContextMenu");
  await expect(copyLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(copyLink).toHaveCount(0);

  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete..." }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await captureScreen(page, "board-delete-confirmation");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);

  await keyboardCard.focus();
  await page.keyboard.press("Shift+F10");
  const deleteItem = page.getByRole("menuitem", { name: "Delete..." });
  await expect(deleteItem).toBeVisible();
  await deleteItem.focus();
  await page.keyboard.press("Enter");
  const deleteConfirmation = page.getByRole("alertdialog");
  await expect(deleteConfirmation).toBeVisible();
  await captureScreen(page, "board-delete-keyboard");
  const deleteButton = deleteConfirmation.getByRole("button", {
    name: "Delete Task",
    exact: true,
  });
  const deletionRequest = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      request.url().endsWith("/api/task/legacy-task-1"),
  );
  await deleteButton.click();
  await deletionRequest;
  await expect(page.locator('[data-task-id="legacy-task-1"]')).toHaveCount(0);
}

async function threeSamplesWithOneRetry(metric: BudgetMetric) {
  const { result, values, retried } = await medianOfThreeWithRetry(
    metric.sample,
    metric.budget,
  );
  console.log(
    "Performance " +
      metric.name +
      ": median " +
      result.toFixed(1) +
      " (" +
      values.map((value) => value.toFixed(1)).join(", ") +
      "); budget < " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  expect(
    result,
    `${metric.name} must be strictly below ${metric.budget} (got ${result.toFixed(1)})`,
  ).toBeLessThan(metric.budget);
  return { ...metric, result, values };
}

async function threeSamplesWithInclusiveRetry(metric: BudgetMetric) {
  const sampleSet = async () => {
    const values = [];
    for (let index = 0; index < 3; index += 1)
      values.push(await metric.sample());
    return values;
  };
  let values = await sampleSet();
  let result = median(values);
  let retried = false;
  if (result > metric.budget) {
    values = await sampleSet();
    result = median(values);
    retried = true;
  }
  console.log(
    "Performance " +
      metric.name +
      ": median " +
      result.toFixed(4) +
      " (" +
      values.map((value) => value.toFixed(4)).join(", ") +
      "); budget ≤ " +
      metric.budget +
      (retried ? "; one retry set used" : ""),
  );
  expect(
    result,
    `${metric.name} must be at most ${metric.budget} (got ${result.toFixed(4)})`,
  ).toBeLessThanOrEqual(metric.budget);
  return { ...metric, result, values };
}

test("G11: work-list render, 500 rows", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list render, 500 rows (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(browser, false, (page) => collectListRender(page)),
  });
});

test("G11: work-list LCP", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list LCP (ms)",
    budget: 2500,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectNavigationMetric(page, "lcp"),
      ),
  });
});

test("G11: work-list CLS", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectNavigationMetric(page, "cls"),
      ),
  });
});

test("G11: work-list to detail route first paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "work-list to work-item route transition (ms)",
    budget: 300,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectRouteTransition(page),
      ),
  });
});

test("G13: detail layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "detail skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openWorkList(page);
          await page
            .getByRole("link", { name: WORK_ITEM_KEY, exact: true })
            .click();
          await expect(page.getByTestId("work-item-detail")).toBeVisible({
            timeout: 15_000,
          });
          return collectG13WindowCls(page, "detail");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: work-list layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "work-list skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openWorkList(page);
          return collectG13WindowCls(page, "work-list");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: board layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "board skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        false,
        async (page) => {
          await openLegacyBoard(page);
          return collectG13WindowCls(page, "board");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: legacy task layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "legacy-task skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await openLegacyTaskDetails(page);
          return collectG13WindowCls(page, "legacy-task");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: Projects layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "Projects skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await collectCommandPaletteInteraction(page, "navigate");
          return collectG13WindowCls(page, "projects");
        },
        { dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13: sign-in layout shift from skeleton to content", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithInclusiveRetry({
    name: "sign-in skeleton-to-content CLS",
    budget: 0.1,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        async (page) => {
          await page.goto("/auth/sign-in");
          await expect(
            page.locator('form button[type="submit"]'),
          ).toBeVisible();
          return collectG13WindowCls(page, "sign-in");
        },
        { authenticated: false, dataDelayMs: 250, g13Windows: true },
      ),
  });
});

test("G13 observer detects a click-initiated skeleton-to-content shift", async ({
  browser,
}) => {
  await withPerformancePage(
    browser,
    false,
    async (page) => {
      await page.goto("/");
      await page.evaluate(() => {
        document.body.innerHTML = `
        <button type="button" data-testid="g13-probe-action">Load content</button>
        <div data-testid="g13-red-probe-loading" style="height:40px">Loading</div>
        <main style="height:700px">
          <p>Visible content below the skeleton</p>
        </main>
      `;
      });
      await page.waitForFunction(
        () =>
          (window as G11Window).__g11Metrics.g13["red-probe"].skeletonMark > 0,
      );
      await page.getByTestId("g13-probe-action").click();
      await page.evaluate(() => {
        const skeleton = document.querySelector(
          '[data-testid="g13-red-probe-loading"]',
        );
        const content = document.createElement("div");
        content.dataset.testid = "g13-red-probe-content";
        content.style.height = "800px";
        content.textContent = "Loaded content";
        skeleton?.replaceWith(content);
      });

      const measurement = await collectG13WindowMeasurement(page, "red-probe");
      expect(measurement.contentMark).toBeGreaterThan(measurement.skeletonMark);
      expect(measurement.cls).toBeGreaterThan(0.1);
      expect(measurement.inputShiftCount).toBeGreaterThan(0);
    },
    { g13Windows: true },
  );
});

test("G11: create-work-item click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "create-work-item interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page, resetFixture) =>
        collectCreateInteraction(page, resetFixture),
      ),
  });
});

test("G11: sign-in click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "sign-in interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(
        browser,
        true,
        (page) => collectSignInInteraction(page),
        { authenticated: false },
      ),
  });
});

test("G11: command-palette click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "command-palette interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page),
      ),
  });
});

test("G11: command-palette keyboard navigation click-to-paint", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "command-palette keyboard navigation click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectCommandPaletteInteraction(page, "navigate"),
      ),
  });
});

test("G11: change task state click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-state interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) =>
        collectTaskStateChange(page),
      ),
  });
});

test("G11: assign task click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-assignment interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) => collectTaskAssignment(page)),
  });
});

test("G11: comment click-to-paint", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "task-comment interaction click-to-paint (ms)",
    budget: 200,
    sample: () =>
      withPerformancePage(browser, true, (page) => collectTaskComment(page)),
  });
});

test("G11: board render, 200 tasks", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "board render, 200 tasks (ms; unthrottled)",
    budget: 500,
    sample: () =>
      withPerformancePage(browser, false, (page) => collectBoardRender(page)),
  });
});

test("G11: board drag p95 frame time", async ({ browser }) => {
  test.setTimeout(120_000);
  await threeSamplesWithOneRetry({
    name: "board drag p95 frame time (ms; unthrottled)",
    budget: 20,
    sample: () =>
      withPerformancePage(browser, false, (page) =>
        collectBoardDragFrameP95(page),
      ),
  });
});

test("G11: board context menu supports keyboard and delete cancel", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, (page) =>
    verifyBoardCardMenu(page),
  );
});

test("G11: 500-row list remains reachable at 200% zoom", async ({
  browser,
}) => {
  await withPerformancePage(browser, false, async (page) => {
    await page.addInitScript(() => {
      document.documentElement.style.zoom = "2";
    });
    await openWorkList(page);
    const rows = page.locator(
      "[data-testid=work-item-list-populated] tbody tr",
    );
    await expect(rows).toHaveCount(500);

    const lastRow = rows.last();
    await lastRow.scrollIntoViewIfNeeded();
    await waitForTwoFrames(page);
    const firstBox = await lastRow.boundingBox();
    await waitForTwoFrames(page);
    const stableBox = await lastRow.boundingBox();
    if (!firstBox || !stableBox)
      throw new Error("The last 200%-zoom work-item row has no layout box.");
    expect(stableBox.y).toBeGreaterThanOrEqual(0);
    expect(stableBox.y + stableBox.height).toBeLessThanOrEqual(720);
    expect(Math.abs(stableBox.y - firstBox.y)).toBeLessThan(1);
    await captureScreen(page, "work-list-200-percent-zoom-last-row");
  });
});
