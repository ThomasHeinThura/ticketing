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

// Shared by the canonical G11 suite and its post-run diagnostic so both use
// the same handlers and datasets without duplicating fixture setup.
export async function installPerformanceApiFixture(
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
        ? json({ enabled: false, required: false, policyMode: "optional" })
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
