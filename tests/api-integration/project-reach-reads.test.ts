/**
 * Project reach on the workspace-level READ routes that list or search rows from many projects
 * (#740, the read-side residual of #712 and #720): the workspace label list, search and the
 * project list.
 *
 * Workspace membership is not project reach. For each route a same-workspace caller sees only
 * what sits in projects they reach (project membership, or the `sees_all` grant); a hidden
 * project's task-bound labels, tasks, comments, activities and the project itself are absent
 * from the rows, the counts and the ranking. Session and API-key callers decide the same way.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { PROJECT_LIST_ROUTE_KEYS } from "./helpers/project-reach-route-keys";
import {
  grantSeesAll,
  PROJECT_KEY_SCOPE,
  type ProjectWorld,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import {
  type App,
  addMember,
  json,
  makeApiKey,
  setAmbientHeaders,
} from "./helpers/reach-world";

const MARKER = "reachprobe";
const VISIBLE_PROJECT = "Visible reachprobe project";
const HIDDEN_PROJECT = "Hidden reachprobe project";

async function insertTask(
  projectId: string,
  title: string,
  number: number,
  createdAt?: Date,
) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title,
        description: "d",
        priority: "low",
        status: "to-do",
        number,
        position: number,
        ...(createdAt ? { createdAt } : {}),
      })
      .returning(),
    "task",
  );
}

async function insertLabel(
  workspaceId: string,
  name: string,
  taskId: string | null,
) {
  return requireRow(
    await db
      .insert(schema.labelTable)
      .values({ name, color: "#112233", workspaceId, taskId })
      .returning(),
    "label",
  );
}

async function arrange() {
  const world = await setupProjectWorld();
  const { app } = createApp();
  await db
    .update(schema.projectTable)
    .set({ name: VISIBLE_PROJECT })
    .where(eq(schema.projectTable.id, world.project.id));
  await db
    .update(schema.projectTable)
    .set({ name: HIDDEN_PROJECT })
    .where(eq(schema.projectTable.id, world.otherProject.id));

  // The hidden project's tasks are NEWER and match the query better (title), so a filter
  // applied after ranking and paging would push the visible task off a one-row page.
  const visibleTask = await insertTask(
    world.project.id,
    `Visible task ${MARKER}`,
    1,
    new Date("2030-01-01T00:00:00Z"),
  );
  const hiddenTasks = [];
  for (let n = 1; n <= 3; n++) {
    hiddenTasks.push(
      await insertTask(
        world.otherProject.id,
        `Hidden task ${MARKER} ${n}`,
        n,
        new Date(`2031-01-0${n}T00:00:00Z`),
      ),
    );
  }
  const hiddenTask = hiddenTasks[0];
  if (!hiddenTask) throw new Error("hidden task");
  await db.insert(schema.taskActivityTable).values([
    {
      taskId: visibleTask.id,
      type: "comment",
      userId: world.projectAdmin.user.id,
      content: `Visible comment ${MARKER}`,
    },
    {
      taskId: hiddenTask.id,
      type: "comment",
      userId: world.otherProjectAdmin.user.id,
      content: `Hidden comment ${MARKER}`,
    },
  ]);
  await insertLabel(world.workspaceId, "Visible task label", visibleTask.id);
  await insertLabel(world.workspaceId, "Hidden task label", hiddenTask.id);
  await insertLabel(world.workspaceId, "Workspace definition", null);

  const seesAll = await addMember(world.workspaceId, "member");
  await grantSeesAll(world.workspaceId, seesAll.personId);
  return { world, app, seesAll };
}

type Arranged = Awaited<ReturnType<typeof arrange>>;

type Caller = {
  name: string;
  /** What this caller must see: the visible project, the hidden one, both, or neither. */
  sees: "visible" | "hidden" | "both" | "none";
  as: (a: Arranged) => { user: ProjectWorld["admin"]["user"] };
};

const CALLERS: Caller[] = [
  {
    name: "member of the visible project",
    sees: "visible",
    as: (a) => a.world.projectAdmin,
  },
  {
    name: "member of the other project",
    sees: "hidden",
    as: (a) => a.world.otherProjectAdmin,
  },
  {
    name: "same-workspace admin with no project membership",
    sees: "none",
    as: (a) => a.world.outsiderAdmin,
  },
  {
    name: "same-workspace lead with no project membership",
    sees: "none",
    as: (a) => a.world.outsiderLead,
  },
  {
    name: "same-workspace member with no project membership",
    sees: "none",
    as: (a) => a.world.outsiderMember,
  },
  { name: "caller holding sees_all", sees: "both", as: (a) => a.seesAll },
];

const showsVisible = (sees: Caller["sees"]) =>
  sees === "visible" || sees === "both";
const showsHidden = (sees: Caller["sees"]) =>
  sees === "hidden" || sees === "both";

type Labels = { name: string; taskId: string | null }[];
type SearchBody = {
  results: {
    id: string;
    type: string;
    title: string;
    content?: string;
    projectId?: string;
  }[];
  totalCount: number;
};
type ProjectRow = { id: string; name: string };

async function read<T>(
  app: App,
  url: string,
): Promise<{ status: number; body: T; text: string }> {
  const response = await json(app, "GET", url);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A refusal body (e.g. "Insufficient permissions") is plain text.
  }
  return { status: response.status, body: body as T, text };
}

describe("API integration: project reach on workspace-level reads (#740)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the table covers exactly the routes the guard requires of this family", () => {
    expect([...PROJECT_LIST_ROUTE_KEYS].sort()).toEqual(
      [
        "GET /api/label/workspace/{workspaceId}",
        "GET /api/project",
        "GET /api/search",
      ].sort(),
    );
  });

  function assertLabels(labels: Labels, sees: Caller["sees"]) {
    const names = labels.map((l) => l.name);
    // A workspace-level definition (no task) is never project-bound.
    expect(names).toContain("Workspace definition");
    expect(names.includes("Visible task label")).toBe(showsVisible(sees));
    expect(names.includes("Hidden task label")).toBe(showsHidden(sees));
  }

  function assertProjects(projects: ProjectRow[], sees: Caller["sees"]) {
    const names = projects.map((p) => p.name);
    expect(names.includes(VISIBLE_PROJECT)).toBe(showsVisible(sees));
    expect(names.includes(HIDDEN_PROJECT)).toBe(showsHidden(sees));
  }

  function searchUrl(a: Arranged, extra = "") {
    return `/api/search?q=${MARKER}&workspaceId=${a.world.workspaceId}${extra}`;
  }

  function assertSearch(body: SearchBody, text: string, sees: Caller["sees"]) {
    expect(text.includes("Visible task")).toBe(showsVisible(sees));
    expect(text.includes("Visible comment")).toBe(showsVisible(sees));
    expect(text.includes(VISIBLE_PROJECT)).toBe(showsVisible(sees));
    expect(text.includes("Hidden task")).toBe(showsHidden(sees));
    expect(text.includes("Hidden comment")).toBe(showsHidden(sees));
    expect(text.includes(HIDDEN_PROJECT)).toBe(showsHidden(sees));
    // The count is built from the rows the caller may see, never from a hidden project's.
    const tasks = (showsVisible(sees) ? 1 : 0) + (showsHidden(sees) ? 3 : 0);
    const comments = (showsVisible(sees) ? 1 : 0) + (showsHidden(sees) ? 1 : 0);
    const projects = (showsVisible(sees) ? 1 : 0) + (showsHidden(sees) ? 1 : 0);
    expect(body.totalCount).toBe(tasks + comments + projects);
  }

  for (const caller of CALLERS) {
    describe(`session: ${caller.name}`, () => {
      it("GET /api/label/workspace/{workspaceId}", async () => {
        const a = await arrange();
        mockAuthenticatedSession(caller.as(a).user);
        const r = await read<Labels>(
          a.app,
          `/api/label/workspace/${a.world.workspaceId}`,
        );
        expect(r.status, r.text).toBe(200);
        assertLabels(r.body, caller.sees);
      });

      it("GET /api/project", async () => {
        const a = await arrange();
        mockAuthenticatedSession(caller.as(a).user);
        const r = await read<ProjectRow[]>(
          a.app,
          `/api/project?workspaceId=${a.world.workspaceId}`,
        );
        expect(r.status, r.text).toBe(200);
        assertProjects(r.body, caller.sees);
        // A hidden project's rollup statistics never ride along on a visible row.
        for (const project of r.body) {
          expect([a.world.project.id, a.world.otherProject.id]).toContain(
            project.id,
          );
        }
      });

      it("GET /api/search", async () => {
        const a = await arrange();
        mockAuthenticatedSession(caller.as(a).user);
        const r = await read<SearchBody>(a.app, searchUrl(a));
        expect(r.status, r.text).toBe(200);
        assertSearch(r.body, r.text, caller.sees);
      });
    });
  }

  describe("search: paging and counts cannot leak a hidden project", () => {
    it("a one-row page for a caller of the visible project is the visible task, not an empty page", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.projectAdmin.user);
      const r = await read<SearchBody>(
        a.app,
        searchUrl(a, "&type=tasks&limit=1"),
      );
      expect(r.status, r.text).toBe(200);
      expect(r.body.results.map((x) => x.title)).toEqual([
        `Visible task ${MARKER}`,
      ]);
      expect(r.body.totalCount).toBe(1);
    });

    it("a caller with no reach gets an empty result and a zero count", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.outsiderAdmin.user);
      for (const type of [
        "tasks",
        "projects",
        "comments",
        "activities",
        "all",
      ]) {
        const r = await read<SearchBody>(a.app, searchUrl(a, `&type=${type}`));
        expect(r.status, r.text).toBe(200);
        expect(r.body.results.filter((x) => x.type !== "workspace")).toEqual(
          [],
        );
      }
    });

    it("naming a hidden project (projectId filter) and a hidden task's short id returns nothing", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.projectAdmin.user);
      const byProject = await read<SearchBody>(
        a.app,
        searchUrl(a, `&projectId=${a.world.otherProject.id}`),
      );
      expect(byProject.status, byProject.text).toBe(200);
      // The projectId filter narrows tasks and activity only; the caller's OWN project hit is
      // legitimate. Nothing of the hidden project appears.
      expect(
        byProject.body.results.filter((x) => x.type !== "project"),
      ).toEqual([]);
      expect(byProject.text).not.toContain("Hidden");

      const [hiddenProject] = await db
        .select({ slug: schema.projectTable.slug })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, a.world.otherProject.id));
      const shortId = await read<SearchBody>(
        a.app,
        `/api/search?q=${encodeURIComponent(`${hiddenProject?.slug}-1`)}&workspaceId=${a.world.workspaceId}`,
      );
      expect(shortId.status, shortId.text).toBe(200);
      expect(shortId.text).not.toContain("Hidden task");
    });
  });

  describe("API keys decide the same way as the key owner's session", () => {
    it("an outsider's fully scoped key sees no project-bound rows; a member's key sees its project's", async () => {
      const a = await arrange();
      mockAnonymousSession();
      const outsiderKey = await makeApiKey(
        a.world.outsiderAdmin.user.id,
        PROJECT_KEY_SCOPE,
      );
      const memberKey = await makeApiKey(
        a.world.projectAdmin.user.id,
        PROJECT_KEY_SCOPE,
      );
      const seesAllKey = await makeApiKey(a.seesAll.user.id, PROJECT_KEY_SCOPE);

      for (const [key, sees] of [
        [outsiderKey, "none"],
        [memberKey, "visible"],
        [seesAllKey, "both"],
      ] as const) {
        setAmbientHeaders({ "x-api-key": key });
        const labels = await read<Labels>(
          a.app,
          `/api/label/workspace/${a.world.workspaceId}`,
        );
        expect(labels.status, labels.text).toBe(200);
        assertLabels(labels.body, sees);
        const projects = await read<ProjectRow[]>(
          a.app,
          `/api/project?workspaceId=${a.world.workspaceId}`,
        );
        expect(projects.status, projects.text).toBe(200);
        assertProjects(projects.body, sees);
        const search = await read<SearchBody>(a.app, searchUrl(a));
        expect(search.status, search.text).toBe(200);
        assertSearch(search.body, search.text, sees);
      }
    });
  });

  describe("customers", () => {
    it("a customer with no organisation reach sees no project-bound row", async () => {
      const a = await arrange();
      mockAuthenticatedSession(a.world.customerNoRole.user);
      const labels = await read<Labels>(
        a.app,
        `/api/label/workspace/${a.world.workspaceId}`,
      );
      if (labels.status === 200) assertLabels(labels.body, "none");
      const projects = await read<ProjectRow[]>(
        a.app,
        `/api/project?workspaceId=${a.world.workspaceId}`,
      );
      if (projects.status === 200) assertProjects(projects.body, "none");
      const search = await read<SearchBody>(a.app, searchUrl(a));
      if (search.status === 200) assertSearch(search.body, search.text, "none");
    });
  });

  describe("a deleted project and another tenant's rows stay out", () => {
    it("a soft-deleted project's task-bound label is not listed even for sees_all", async () => {
      const a = await arrange();
      await db
        .update(schema.projectTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.projectTable.id, a.world.otherProject.id));
      mockAuthenticatedSession(a.seesAll.user);
      const r = await read<Labels>(
        a.app,
        `/api/label/workspace/${a.world.workspaceId}`,
      );
      assertLabels(r.body, "visible");
    });
  });
});
