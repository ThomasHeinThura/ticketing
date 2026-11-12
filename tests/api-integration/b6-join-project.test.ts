import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { authorityFor } from "../../packages/permissions/src/evaluator";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addCanonicalMember,
  addMember,
  json,
  makeApiKey,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

describe("B-6 session self-join", () => {
  beforeEach(resetTestDatabase);
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });
  for (const role of [
    "owner",
    "admin",
    "manager",
    "lead",
    "member",
    "viewer",
    "custom",
  ] as const) {
    it(`${role}: join eligibility, idempotency, audit and unchanged authority`, async () => {
      const world = await setupWorld();
      const seeded =
        role === "manager"
          ? await addCanonicalMember(world.workspaceId, role)
          : await addMember(world.workspaceId, role);
      const initial = await resolveIdentity({
        userId: seeded.user.id,
        credential: "session",
      });
      if (!initial) throw new Error("missing initial identity");
      const caller = { ...seeded, personId: initial.personId };
      mockAuthenticatedSession(caller.user);
      const { app } = createApp();
      const target = {
        workspaceId: world.workspaceId,
        projectId: world.project.id,
      };
      const resolve = () =>
        resolveIdentity({ userId: caller.user.id, credential: "session" });
      const gates = async () => {
        const body = {
          name: world.project.name,
          icon: world.project.icon,
          slug: world.project.slug,
          description: "B6",
        };
        const update = await json(
          app,
          "PUT",
          `/api/project/${world.project.id}`,
          body,
        );
        const settings = await json(
          app,
          "PUT",
          `/api/project/${world.project.id}`,
          { ...body, defaultCommentVisibility: "internal" },
        );
        const milestone = await json(
          app,
          "POST",
          `/api/project/${world.project.id}/milestones`,
          { name: "B6", date: "2031-01-01T00:00:00.000Z" },
        );
        const archive = await json(
          app,
          "PUT",
          `/api/project/${world.project.id}/archive`,
        );
        await json(app, "PUT", `/api/project/${world.project.id}/unarchive`);
        const deletion = await json(
          app,
          "DELETE",
          `/api/project/${world.project.id}`,
        );
        return [
          update.status,
          settings.status,
          milestone.status,
          archive.status,
          deletion.status,
        ];
      };
      const gatesBefore = await gates();
      const before = await resolve();
      if (!before) throw new Error("missing identity");
      const capsBefore = authorityFor(before, "project", target);
      const capabilitiesBefore = await json(
        app,
        "GET",
        `/api/capabilities?workspaceId=${world.workspaceId}&projectId=${world.project.id}`,
      );
      const response = await json(
        app,
        "POST",
        `/api/projects/${world.project.id}/join`,
      );
      if (!["owner", "admin", "manager"].includes(role)) {
        expect(response.status).toBe(403);
        return;
      }
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        (await json(app, "POST", `/api/projects/${world.project.id}/join`))
          .status,
      ).toBe(200);
      const concurrent = await Promise.all([
        json(app, "POST", `/api/projects/${world.project.id}/join`),
        json(app, "POST", `/api/projects/${world.project.id}/join`),
      ]);
      expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
      const after = await resolve();
      if (!after) throw new Error("missing identity");
      expect([...authorityFor(after, "project", target)].sort()).toEqual(
        [...capsBefore].sort(),
      );
      const capabilitiesAfter = await json(
        app,
        "GET",
        `/api/capabilities?workspaceId=${world.workspaceId}&projectId=${world.project.id}`,
      );
      expect(capabilitiesBefore.status).toBe(200);
      expect(capabilitiesAfter.status).toBe(200);
      expect(await capabilitiesAfter.json()).toEqual(
        await capabilitiesBefore.json(),
      );
      expect(await gates()).toEqual(gatesBefore);
      // Deletion still requires its existing session/step-up gates, unchanged by joining.
      expect(gatesBefore).toEqual([200, 200, 200, 200, 403]);
      const grants = await db
        .select()
        .from(schema.membershipGrantTable)
        .where(
          and(
            eq(schema.membershipGrantTable.personId, caller.personId),
            eq(schema.membershipGrantTable.scopeId, world.project.id),
          ),
        );
      expect(grants).toHaveLength(1);
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.actorId, caller.user.id),
            eq(schema.auditLogTable.projectId, world.project.id),
            eq(schema.auditLogTable.action, "membership.changed"),
          ),
        );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.workspaceId).toBe(world.workspaceId);
    });
  }
  it("refuses API keys, customers, foreign workspaces and suspended managers", async () => {
    const world = await setupWorld();
    const caller = await addMember(world.workspaceId, "manager");
    const { app } = createApp();
    const url = `/api/projects/${world.project.id}/join`;
    const key = await makeApiKey(caller.user.id, {
      project: ["read", "update", "manage_members"],
    });
    mockAnonymousSession();
    setAmbientHeaders({ "x-api-key": key });
    expect((await json(app, "POST", url)).status).toBe(403);
    setAmbientHeaders({});
    mockAuthenticatedSession(world.customerNoRole.user);
    expect((await json(app, "POST", url)).status).toBe(403);
    const foreign = await setupWorld();
    mockAuthenticatedSession(foreign.admin.user);
    expect((await json(app, "POST", url)).status).toBe(403);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, caller.personId));
    mockAuthenticatedSession(caller.user);
    expect((await json(app, "POST", url)).status).toBe(403);
  });
  it("refuses an impersonated manager", async () => {
    const world = await setupWorld();
    const caller = await addMember(world.workspaceId, "manager");
    mockAuthenticatedSession(caller.user, {
      impersonatedBy: world.admin.user.id,
    });
    const { app } = createApp();
    expect(
      (await json(app, "POST", `/api/projects/${world.project.id}/join`))
        .status,
    ).toBe(403);
  });
});
