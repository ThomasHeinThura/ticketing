import type { Page } from "@playwright/test";

/**
 * Network-edge fixture for the project Overview (S3/S3b) on top of a project fixture that
 * already answers `/api/project?workspaceId=` and `/api/project/{id}`. Registered after it, so
 * Playwright tries these routes first and falls back for everything else. Writes are stateful
 * so a reload shows what was saved.
 */
export async function installProjectOverviewFixture(
  page: Page,
  projectId: string,
  options: {
    kind?: "project" | "managed_service";
    /** The project row the base fixture serves; the Overview reads its summary from it. */
    project?: Record<string, unknown>;
    /** A contract to start with (the `PUT` body shape); none by default. */
    contract?: Record<string, unknown>;
    /** False answers as the API does for a caller without `time_entry:read_any`. */
    recentEntriesVisible?: boolean;
  } = {},
) {
  const state = {
    summary: {
      objective: "Move first-line support onto TaskDesk",
      inScope: "Incidents and service requests",
      outOfScope: "Hardware replacement",
      successCriteria: "Every P1 answered within 15 minutes",
      statusNote: "Waiting for the customer's VPN access",
      statusNoteAt: "2026-10-30T09:00:00.000Z",
      status: "active",
    },
    contract: (options.contract ?? null) as null | Record<string, unknown>,
    requests: [] as Array<{ method: string; path: string; body: unknown }>,
    /**
     * Writes to refuse, keyed `METHOD /tail` (e.g. `POST /milestones`, `POST /stakeholders/s1/stand-down`),
     * with the HTTP status to answer. A refused write changes nothing.
     */
    refuse: new Map<string, number>(),
    milestones: [
      {
        id: "m1",
        projectId,
        name: "Kick-off",
        date: "2026-01-05T00:00:00.000Z",
        reachedAt: "2026-01-05T00:00:00.000Z" as string | null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "m2",
        projectId,
        name: "Go-live",
        date: "2099-03-01T00:00:00.000Z",
        reachedAt: null as string | null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    prerequisites: [
      {
        id: "r1",
        projectId,
        title: "Customer VPN access",
        ownerSide: "customer",
        dueDate: "2026-11-15T00:00:00.000Z" as string | null,
        isBlocking: true,
        completedAt: null as string | null,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    stakeholders: [
      {
        id: "s1",
        projectId,
        personId: "person-1",
        role: "Project manager",
        escalationOrder: 1,
        escalationWaitMinutes: 30,
        displayName: "Mia Manager" as string | null,
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ],
  };
  let nextId = 1;
  const overview = () => ({
    projectId,
    kind: options.kind ?? "project",
    status: state.summary.status,
    health: "amber",
    archived: false,
    counts: {
      open: 12,
      breached: 2,
      inProgress: 5,
      waiting: 1,
      done: 30,
      total: 42,
      blockingPrerequisitesOutstanding: 1,
      prerequisites: 3,
    },
    currentMilestone: {
      id: "m2",
      name: "Go-live",
      date: "2099-03-01T00:00:00.000Z",
    },
    overdueMilestoneIds: [],
    compositionWarnings: [],
    facts: {
      customerName: "Acme Ltd",
      managerName: "Mia Manager",
      defaultAssigneeName: "Sam Support",
      supportLevel: options.kind === "managed_service" ? "L2" : null,
      serviceCalendarName: "Business hours",
      startDate: "2026-01-05",
      endDate: "2099-06-30",
    },
    serviceLevels: {
      policyName: "Gold support",
      source: "project",
      goals: (["urgent", "high"] as const).flatMap((priority) => [
        {
          metric: "first_response",
          workItemTypeName: "Incident",
          priority,
          targetMinutes: priority === "urgent" ? 15 : 60,
        },
        {
          metric: "resolution",
          workItemTypeName: "Incident",
          priority,
          targetMinutes: priority === "urgent" ? 240 : 480,
        },
      ]),
    },
  });
  const contract = () =>
    state.contract
      ? {
          projectId,
          contract: {
            ...state.contract,
            updatedAt: "2026-10-31T00:00:00.000Z",
          },
          state: "active",
          daysRemaining: 200,
          hourBank: {
            contractedMinutes: state.contract.contractedMinutes as number,
            usedMinutes: 2700,
            remainingMinutes:
              (state.contract.contractedMinutes as number) - 2700,
            usedPct: Math.round(
              (2700 / (state.contract.contractedMinutes as number)) * 100,
            ),
          },
          recentEntries:
            options.recentEntriesVisible === false
              ? []
              : [
                  {
                    id: "e1",
                    date: "2026-10-29",
                    minutes: 90,
                    workItemKey: null,
                  },
                ],
          recentEntriesVisible: options.recentEntriesVisible ?? true,
        }
      : {
          projectId,
          contract: null,
          state: "none",
          daysRemaining: null,
          hourBank: null,
          recentEntries: [],
          recentEntriesVisible: options.recentEntriesVisible ?? true,
        };

  await page.route(`**/api/project/${projectId}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/\/+$/, "");
    const tail = path.slice(`/api/project/${projectId}`.length);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const method = request.method();
    if (method !== "GET") {
      state.requests.push({ method, path, body: request.postDataJSON() });
      const refusal = state.refuse.get(`${method} ${tail}`);
      if (refusal)
        return json(
          { message: refusal === 403 ? "Forbidden" : "Internal error" },
          refusal,
        );
    }
    if (tail === "/overview" && method === "GET") return json(overview());
    if (tail === "/contract" && method === "GET") return json(contract());
    if (tail === "/contract" && method === "PUT") {
      state.contract = request.postDataJSON();
      return json(contract());
    }
    if (tail === "/summary" && method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      Object.assign(state.summary, body);
      if ("statusNote" in body)
        state.summary.statusNoteAt = "2026-10-31T12:00:00.000Z";
      return json({ projectId, ...state.summary });
    }
    if (tail === "/milestones" && method === "GET")
      return json(state.milestones);
    if (tail === "/milestones" && method === "POST") {
      const body = request.postDataJSON() as { name: string; date: string };
      const created = {
        id: `m-new-${nextId++}`,
        projectId,
        name: body.name,
        date: body.date,
        reachedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      };
      state.milestones.push(created);
      return json(created, 201);
    }
    if (tail === "/prerequisites" && method === "GET")
      return json(state.prerequisites);
    if (tail === "/prerequisites" && method === "POST") {
      const body = request.postDataJSON() as {
        title: string;
        ownerSide: string;
        dueDate: string | null;
        isBlocking: boolean;
      };
      const created = {
        id: `r-new-${nextId++}`,
        projectId,
        ...body,
        completedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      };
      state.prerequisites.push(created);
      return json(created, 201);
    }
    const prerequisite = /^\/prerequisites\/([^/]+)$/u.exec(tail);
    if (prerequisite && method === "PATCH") {
      const row = state.prerequisites.find((p) => p.id === prerequisite[1]);
      if (!row) return json({ message: "Not found" }, 404);
      const body = request.postDataJSON() as { completed?: boolean };
      if (body.completed !== undefined)
        row.completedAt = body.completed ? "2026-11-01T10:00:00.000Z" : null;
      return json(row);
    }
    if (tail === "/stakeholders" && method === "GET")
      return json(state.stakeholders);
    const standDown = /^\/stakeholders\/([^/]+)\/stand-down$/u.exec(tail);
    if (standDown && method === "POST") {
      const row = state.stakeholders.find((p) => p.id === standDown[1]);
      if (!row) return json({ message: "Not found" }, 404);
      row.active = false;
      return json(row);
    }
    if (tail === "/document-links" && method === "GET")
      return json([
        {
          id: "d1",
          projectId,
          url: "https://docs.example.test/sow",
          title: "Statement of work",
          customerVisible: true,
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ]);
    if (tail === "/archive" && method === "PUT")
      return json({
        ...options.project,
        id: projectId,
        archivedAt: "2026-11-01T00:00:00.000Z",
      });
    if (tail === "/health" && method === "GET")
      return json({ health: "amber" });
    return route.fallback();
  });
  await page.route(
    new RegExp(`/api/project/${projectId}(\\?.*)?$`, "u"),
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              kind: options.kind ?? "project",
              health: "amber",
              supportLevel: null,
              serviceCalendarId: null,
              slaPolicyId: null,
              parentId: null,
              ownerTeamId: null,
              managerId: null,
              startDate: "2026-01-05",
              endDate: "2099-06-30",
              defaultAssigneeId: null,
              organisationId: null,
              createdBy: null,
              ...options.project,
              ...state.summary,
              compositionWarnings: [],
            }),
          })
        : route.fallback(),
  );
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        members: [
          {
            personId: "person-1",
            displayName: "Mia Manager",
            active: true,
            jobTitle: "Delivery lead",
            roleId: "role-lead",
            roleKey: "lead",
            roleName: "Lead",
            roleRank: 3,
            source: "direct",
            inheritedFrom: null,
            overridesInherited: null,
            managedExternally: false,
            removable: true,
          },
        ],
        roles: [],
        callerRank: 3,
      }),
    }),
  );
  return state;
}
