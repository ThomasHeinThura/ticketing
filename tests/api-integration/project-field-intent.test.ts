/**
 * PTM-04 field-intent `PUT /api/project/{id}` against a fresh test database.
 *
 * Two independent HTTP callers stand for two browsers: each request carries only its own body
 * and resolves its own authority through `app.request`, so nothing in memory orders them. The
 * shared state is the project row. Same-field concurrent writes are last-writer-wins and a
 * legacy full body still overwrites all four base fields (retained compatibility limits).
 *
 * Denial statuses are the retained ones, not new decisions: reach is decided before the
 * capability (`permissions/matrix.fixture.json` "PUT /api/project/{id}": out of reach 404
 * byte-identical to a missing project, in reach without the capability 403,
 * `project-scoped-reach.test.ts`), and the CA-2 rules for the strict `project:manage_settings`
 * check and API-key scope (`project-default-comment-visibility.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
} from "./helpers/fixtures";
import {
  missingIds,
  projectSnapshot,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import { MATRIX, makeApiKey, matrixStatus } from "./helpers/reach-world";

type App = ReturnType<typeof createApp>["app"];

const AUDIT_ACTION = "project.general_settings_updated";

const put = (
  app: App,
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(`/api/project/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const read = (id: string) =>
  db.query.projectTable.findFirst({ where: eq(schema.projectTable.id, id) });

const claimHolder = async (slug: string) =>
  (
    await db.query.projectSlugClaimTable.findFirst({
      where: eq(schema.projectSlugClaimTable.slug, slug),
    })
  )?.projectId;

/** Project rows and children, every slug claim, and every project audit row, as one string. */
async function persistedState() {
  return JSON.stringify({
    snapshot: await projectSnapshot(),
    claims: await db
      .select()
      .from(schema.projectSlugClaimTable)
      .orderBy(schema.projectSlugClaimTable.slug),
    audit: (
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, AUDIT_ACTION))
        .orderBy(asc(schema.auditLogTable.seq))
    ).map((row) => row.id),
  });
}

/**
 * Holds the row lock of one project in its own transaction. `release` ends it; `done` settles
 * when the transaction has ended; `pid` is that transaction's backend, so a test can observe
 * which requests are blocked BY IT (and therefore by this project's row) in `pg_locks`.
 */
async function holdProjectRowLock(projectId: string) {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let announce: (pid: number) => void = () => {};
  const announced = new Promise<number>((resolve) => {
    announce = resolve;
  });
  const done = db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM project WHERE id = ${projectId} FOR UPDATE`,
    );
    const backend = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
    announce(Number((backend.rows[0] as { pid: number | string }).pid));
    await released;
  });
  const pid = await Promise.race([
    announced,
    done.then(() => {
      throw new Error("The row-lock transaction ended before it held the lock");
    }),
  ]);
  return { pid, release, done };
}

/**
 * Waits until `count` DISTINCT project-update backends (the update's `SELECT … FROM "project" …
 * FOR UPDATE` or its `UPDATE "project"`) are blocked, directly or transitively, by the lock
 * holder's transaction. A second writer queued behind the first is blocked by the first writer
 * (and, through it, by the holder), so counting only `pg_blocking_pids(waiter) ∋ holder` would
 * miss it. Same recursive chain as `intake-atomic-conversion.test.ts`
 * (`waitForBlockedProjectAcceptances`): the walk stops at the holder, and the depth bound
 * prevents endless recursion if the blocking graph contains a cycle.
 */
async function waitForBlockedBy(holderPid: number, count: number) {
  const deadline = Date.now() + 10_000;
  let blocked = 0;
  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      WITH RECURSIVE blocking_chain(waiter_pid, blocker_pid, depth) AS (
        SELECT activity.pid, unnest(pg_blocking_pids(activity.pid)), 1
        FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND (
            (activity.query ILIKE '%from "project"%'
              AND activity.query ILIKE '%for update%')
            OR activity.query ILIKE '%update "project"%'
          )
        UNION
        SELECT chain.waiter_pid, unnest(pg_blocking_pids(chain.blocker_pid)),
               chain.depth + 1
        FROM blocking_chain AS chain
        WHERE chain.blocker_pid <> ${holderPid}::int
          AND chain.depth < 8
      )
      SELECT count(DISTINCT waiter_pid)::int AS blocked
      FROM blocking_chain
      WHERE blocker_pid = ${holderPid}::int
    `);
    blocked = Number((result.rows[0] as { blocked: number | string }).blocked);
    if (blocked >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out: ${blocked} of ${count} project updates were blocked, directly or through a queued writer, on the held row lock`,
  );
}

describe("API integration: project PUT applies only the supplied fields (PTM-04)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function arrange(slug = "FIELDONE") {
    const actor = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const created = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: actor.workspace.id,
        name: "Field intent",
        icon: "Folder",
        slug,
      }),
    });
    expect(created.status).toBe(200);
    const project = (await created.json()) as { id: string };
    await grantProjectManageAccess(actor.user.id, project.id);
    return { actor, app, project };
  }

  describe("independent clients", () => {
    it("a stale optional-setting save cannot restore the old key another client confirmed, and its own change is not lost", async () => {
      const { app, project } = await arrange();
      // New projects start with comment visibility `internal`: the save below changes it to
      // `public`, so a lost or ignored save cannot pass as an unchanged value.
      expect((await read(project.id))?.defaultCommentVisibility).toBe(
        "internal",
      );
      // Both clients loaded the project while the key was FIELDONE.
      expect((await app.request(`/api/project/${project.id}`)).status).toBe(
        200,
      );
      expect((await put(app, project.id, { slug: "FIELDNEW" })).status).toBe(
        200,
      );
      expect((await read(project.id))?.defaultCommentVisibility).toBe(
        "internal",
      );
      const optional = await put(app, project.id, {
        defaultCommentVisibility: "public",
      });
      expect(optional.status).toBe(200);
      expect(
        ((await optional.json()) as { defaultCommentVisibility: string })
          .defaultCommentVisibility,
      ).toBe("public");
      const row = await read(project.id);
      expect(row?.slug).toBe("FIELDNEW");
      expect(row?.defaultCommentVisibility).toBe("public");
      expect(await claimHolder("FIELDONE")).toBe(project.id);
      expect(await claimHolder("FIELDNEW")).toBe(project.id);
    });

    it.each(["optional save queued first", "rename queued first"])(
      "a rename and an optional save blocked on the same row lock both persist (%s)",
      async (order) => {
        const { app, project } = await arrange();
        // New projects start `internal`; both orderings change it to `public`, so a lost
        // optional save cannot pass as an unchanged value.
        expect((await read(project.id))?.defaultCommentVisibility).toBe(
          "internal",
        );
        const lock = await holdProjectRowLock(project.id);
        const requests: Array<Response | Promise<Response>> = [];
        const send = (body: Record<string, unknown>) => {
          const request = put(app, project.id, body);
          requests.push(request);
          return request;
        };
        try {
          const [first, second] =
            order === "optional save queued first"
              ? [{ defaultCommentVisibility: "public" }, { slug: "FIELDLOCK" }]
              : [{ slug: "FIELDLOCK" }, { defaultCommentVisibility: "public" }];
          send(first);
          // Each request is observed waiting on THIS project's row lock before the next is sent.
          await waitForBlockedBy(lock.pid, 1);
          send(second);
          await waitForBlockedBy(lock.pid, 2);
        } finally {
          // Whatever happened above, the lock ends and every sent request settles before the
          // test moves on, so a failure here cannot leave a held lock or a dangling request.
          lock.release();
          await lock.done;
          await Promise.allSettled(requests);
        }
        const responses = await Promise.all(requests);
        expect(responses.map((response) => response.status)).toEqual([
          200, 200,
        ]);
        const optionalResponse =
          responses[order === "optional save queued first" ? 0 : 1];
        if (!optionalResponse)
          throw new Error("optional save response missing");
        expect(
          (
            (await optionalResponse.json()) as {
              defaultCommentVisibility: string;
            }
          ).defaultCommentVisibility,
        ).toBe("public");
        const row = await read(project.id);
        expect(row?.slug).toBe("FIELDLOCK");
        expect(row?.defaultCommentVisibility).toBe("public");
        expect(await claimHolder("FIELDLOCK")).toBe(project.id);
      },
    );

    it("mirror: a description edit and a rename from independent clients both persist", async () => {
      const { app, project } = await arrange();
      expect((await read(project.id))?.description).not.toBe("kept");
      expect((await put(app, project.id, { description: "kept" })).status).toBe(
        200,
      );
      expect((await put(app, project.id, { slug: "FIELDMIR" })).status).toBe(
        200,
      );
      expect(await read(project.id)).toMatchObject({
        description: "kept",
        slug: "FIELDMIR",
      });
    });

    it("two clients writing the SAME field: last writer wins, both succeed (documented limit)", async () => {
      const { app, project } = await arrange();
      expect((await read(project.id))?.name).toBe("Field intent");
      expect((await put(app, project.id, { name: "From A" })).status).toBe(200);
      expect((await read(project.id))?.name).toBe("From A");
      expect((await put(app, project.id, { name: "From B" })).status).toBe(200);
      expect((await read(project.id))?.name).toBe("From B");
    });

    it("a legacy full body still replaces all four base fields exactly as before", async () => {
      const { app, project } = await arrange();
      expect(await read(project.id)).toMatchObject({
        name: "Field intent",
        icon: "Folder",
        slug: "FIELDONE",
      });
      const response = await put(app, project.id, {
        name: "Legacy",
        icon: "Star",
        slug: "FIELDLEG",
        description: "full",
      });
      expect(response.status).toBe(200);
      expect(await read(project.id)).toMatchObject({
        name: "Legacy",
        icon: "Star",
        slug: "FIELDLEG",
        description: "full",
      });
    });
  });

  describe("body shape", () => {
    it.each([
      ["an empty body", {}],
      ["a body with only an ignored parentId", { parentId: randomUUID() }],
      ["a body with only an unknown key", { visibility: "public" }],
      ["an explicit null name", { name: null }],
      ["an explicit null slug", { slug: null }],
    ])("rejects %s with 400 and changes nothing", async (_label, body) => {
      const { app, project } = await arrange();
      const before = await persistedState();
      expect((await put(app, project.id, body)).status).toBe(400);
      expect(await persistedState()).toBe(before);
    });

    it("never touches the key, its claim or the clash checks when no slug is sent", async () => {
      const { app, project } = await arrange();
      // A pre-PR-13 style key that would fail the key pattern if it were re-validated.
      await db
        .update(schema.projectTable)
        .set({ slug: "legacy-key" })
        .where(eq(schema.projectTable.id, project.id));
      expect(
        (await put(app, project.id, { name: "Renamed only" })).status,
      ).toBe(200);
      expect(await read(project.id)).toMatchObject({
        name: "Renamed only",
        slug: "legacy-key",
      });
      expect(await claimHolder("legacy-key")).toBeUndefined();
    });

    it("still validates a changed key, refuses a taken one, and lets a project take back its own claim", async () => {
      const { app, project } = await arrange();
      const workspaceId = (await read(project.id))?.workspaceId;
      expect((await put(app, project.id, { slug: "bad-key" })).status).toBe(
        400,
      );
      const other = await app.request("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: "Other",
          icon: "Folder",
          slug: "FIELDOTH",
        }),
      });
      expect(other.status).toBe(200);
      expect((await put(app, project.id, { slug: "FIELDOTH" })).status).toBe(
        409,
      );
      expect((await put(app, project.id, { slug: "FIELDTWO" })).status).toBe(
        200,
      );
      expect((await put(app, project.id, { slug: "FIELDONE" })).status).toBe(
        200,
      );
      expect((await read(project.id))?.slug).toBe("FIELDONE");
    });

    it("a soft-deleted project is 404 for any body", async () => {
      const { app, project } = await arrange();
      await db
        .update(schema.projectTable)
        .set({ deletedAt: new Date() })
        .where(eq(schema.projectTable.id, project.id));
      expect((await put(app, project.id, { name: "x" })).status).toBe(404);
      expect(
        (await put(app, project.id, { defaultCommentVisibility: "internal" }))
          .status,
      ).toBe(404);
    });

    it("PR-9 under the lock: clearing the support level of a managed service is 422 with no partial write", async () => {
      const { app, project } = await arrange();
      const workspaceId = (await read(project.id))?.workspaceId;
      if (!workspaceId) throw new Error("project workspace missing");
      const [calendar] = await db
        .insert(schema.serviceCalendarTable)
        .values({
          workspaceId,
          name: "Support coverage",
          timezone: "UTC",
          windows: { mon: [{ from: 540, to: 1020 }] },
          holidays: [],
        })
        .returning();
      if (!calendar) throw new Error("service calendar insert returned no row");
      expect(
        (
          await put(app, project.id, {
            kind: "managed_service",
            supportLevel: "L2",
            serviceCalendarId: calendar.id,
          })
        ).status,
      ).toBe(200);
      const before = await persistedState();
      const refused = await put(app, project.id, {
        supportLevel: null,
        description: "must not persist",
      });
      expect(refused.status).toBe(422);
      expect(await persistedState()).toBe(before);
    });
  });

  describe("denials write nothing, for every body shape", () => {
    const BODIES: Array<Record<string, unknown>> = [
      { slug: "DENYNEW" },
      { name: "Denied rename" },
      { description: "denied description" },
      { defaultCommentVisibility: "public" },
      { slug: "DENYBOTH", defaultCommentVisibility: "public" },
    ];
    const MATRIX_KEY = "PUT /api/project/{id}";

    it("a foreign-tenant admin and every same-workspace caller outside project reach get the matrix's 404, byte-identical to a missing project", async () => {
      const world = await setupProjectWorld();
      const foreign = await createWorkspaceMember({ role: "admin" });
      const { app } = createApp();
      const declared = matrixStatus(
        MATRIX.routes[MATRIX_KEY]?.member?.outOfReach,
      );
      expect(declared).toBe(404);

      mockAuthenticatedSession(world.projectAdmin.user);
      const missing = await put(app, missingIds().projectId, BODIES[0]);
      const missingText = await missing.text();
      expect(missing.status, missingText).toBe(404);

      const before = await persistedState();
      for (const outsider of [
        foreign,
        world.outsiderLead,
        world.outsiderMember,
        world.outsiderAdmin,
        // Fully capable on ANOTHER project of the same workspace: not reach to this one.
        world.otherProjectAdmin,
      ]) {
        mockAuthenticatedSession(outsider.user);
        for (const body of BODIES) {
          const response = await put(app, world.project.id, body);
          const text = await response.text();
          expect(response.status, `${JSON.stringify(body)}: ${text}`).toBe(
            declared,
          );
          expect(text).toBe(missingText);
        }
      }
      expect(await persistedState()).toBe(before);
    });

    it("a project member whose project membership is revoked is refused like an outsider and writes nothing", async () => {
      const world = await setupProjectWorld();
      const { app } = createApp();
      mockAuthenticatedSession(world.projectAdmin.user);
      expect(
        (await put(app, world.project.id, { description: "before revoke" }))
          .status,
      ).toBe(200);
      const missing = await put(app, missingIds().projectId, BODIES[0]);
      const missingText = await missing.text();

      await db
        .delete(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, world.projectAdmin.personId),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, world.project.id),
          ),
        );

      const before = await persistedState();
      for (const body of BODIES) {
        const response = await put(app, world.project.id, body);
        const text = await response.text();
        expect(response.status, `${JSON.stringify(body)}: ${text}`).toBe(
          matrixStatus(MATRIX.routes[MATRIX_KEY]?.member?.outOfReach),
        );
        expect(text).toBe(missingText);
      }
      expect(await persistedState()).toBe(before);
    });

    it("a caller who reaches the project with a read-only project role gets the matrix's 403 for every body shape", async () => {
      const world = await setupProjectWorld();
      const { app } = createApp();
      expect(matrixStatus(MATRIX.routes[MATRIX_KEY]?.viewer?.inReach)).toBe(
        403,
      );
      const before = await persistedState();
      mockAuthenticatedSession(world.readerAdmin.user);
      for (const body of BODIES) {
        const response = await put(app, world.project.id, body);
        expect(response.status, JSON.stringify(body)).toBe(403);
      }
      mockAuthenticatedSession(world.readerLead.user);
      for (const body of BODIES) {
        const response = await put(app, world.project.id, body);
        expect(response.status, JSON.stringify(body)).toBe(403);
      }
      expect(await persistedState()).toBe(before);
    });

    describe("role-narrowed caller: project:update without project:manage_settings (CA-2)", () => {
      async function narrowedMember() {
        const actor = await createWorkspaceMember({ role: "member" });
        const legacy = JSON.stringify({ project: ["read", "update"] });
        const existing = await db
          .select({ id: schema.workspaceRoleTable.id })
          .from(schema.workspaceRoleTable)
          .where(eq(schema.workspaceRoleTable.workspaceId, actor.workspace.id));
        if (existing.length > 0) {
          await db
            .update(schema.workspaceRoleTable)
            .set({ permission: legacy })
            .where(
              eq(schema.workspaceRoleTable.workspaceId, actor.workspace.id),
            );
        } else {
          const now = new Date();
          await db.insert(schema.workspaceRoleTable).values({
            workspaceId: actor.workspace.id,
            role: "member",
            permission: legacy,
            isSystem: true,
            createdAt: now,
            updatedAt: now,
          });
        }
        const { project } = await createProjectFixture({
          workspaceId: actor.workspace.id,
        });
        await grantProjectRole(actor.user.id, project.id, [
          "project:read",
          "project:update",
        ]);
        mockAuthenticatedSession(actor.user);
        return { actor, project, app: createApp().app };
      }

      it("may change base fields alone, and is refused 403 the moment a settings field rides along", async () => {
        const { project, app } = await narrowedMember();
        const refusedBodies: Array<Record<string, unknown>> = [
          { defaultCommentVisibility: "public" },
          { slug: "NARROWBND", defaultCommentVisibility: "public" },
          { name: "Bundled rename", managerId: null },
        ];
        const before = await persistedState();
        for (const body of refusedBodies) {
          const response = await put(app, project.id, body);
          expect(response.status, JSON.stringify(body)).toBe(403);
        }
        // Nothing of a refused body lands: not the bundled key, its claim, or an audit row.
        expect(await persistedState()).toBe(before);
        expect(await claimHolder("NARROWBND")).toBeUndefined();

        const plain = await put(app, project.id, { slug: "NARROWKEY" });
        expect(plain.status, await plain.clone().text()).toBe(200);
        expect(await read(project.id)).toMatchObject({
          slug: "NARROWKEY",
          defaultCommentVisibility: "internal",
        });
      });
    });

    it("API key scope: project:update alone may send base fields, a settings field is 403 'Insufficient API key scope', a manage_settings scope allows it", async () => {
      const { actor, app, project } = await arrange("KEYSCOPE");
      const narrowKey = await makeApiKey(actor.user.id, {
        project: ["read", "update"],
      });
      const before = await persistedState();
      const denied = await put(
        app,
        project.id,
        { defaultCommentVisibility: "public" },
        { "x-api-key": narrowKey },
      );
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("Insufficient API key scope");
      expect(await persistedState()).toBe(before);

      const base = await put(
        app,
        project.id,
        { slug: "KEYSCOPENEW" },
        { "x-api-key": narrowKey },
      );
      expect(base.status, await base.clone().text()).toBe(200);
      expect((await read(project.id))?.slug).toBe("KEYSCOPENEW");

      // The refused settings write left the default `internal`, so the allowed one below
      // changes it to `public` and cannot pass as an unchanged value.
      expect((await read(project.id))?.defaultCommentVisibility).toBe(
        "internal",
      );
      const wideKey = await makeApiKey(actor.user.id, {
        project: ["read", "update", "manage_settings"],
      });
      const allowed = await put(
        app,
        project.id,
        { defaultCommentVisibility: "public" },
        { "x-api-key": wideKey },
      );
      expect(allowed.status, await allowed.clone().text()).toBe(200);
      expect((await read(project.id))?.defaultCommentVisibility).toBe("public");
    });
  });
});
