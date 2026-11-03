/**
 * D7 customer announcements (feature-contracts-p5.md "Announcements"): staff management under
 * `service:manage`, audience isolation between customer organisations, drafts and the time
 * window, cross-workspace isolation, optimistic concurrency, audit rows and pending deletion.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  announcementProjectTable,
  announcementTable,
} from "../../apps/api/src/database/schema-p5-service";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { auditActions, type KbWorld, kbWorld } from "./helpers/p5-kb";
import { setServiceFlag } from "./helpers/p5-service";
import {
  approvePendingDeletion,
  ensureAgentSession,
} from "./helpers/pending-deletion";
import { grantSeesAll } from "./helpers/project-reach-world";
import { addMember } from "./helpers/reach-world";

type Announcement = {
  id: string;
  version: number;
  publishedAt: string | null;
  organisations: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  reachesAudience: boolean;
};

let w: KbWorld;

beforeEach(async () => {
  await resetTestDatabase();
  w = await kbWorld();
  await setServiceFlag(w.workspaceId, true);
  // Fabrikam (customer B) is served by project B in the same workspace as Contoso (A).
  await db
    .update(schema.projectTable)
    .set({ organisationId: w.customerB.orgId })
    .where(eq(schema.projectTable.id, w.projectB.id));
  // The owner reaches every project of the workspace, as owners do after the sees-all migration.
  const [owner] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, w.owner.user.id));
  if (!owner) throw new Error("owner person missing");
  await grantSeesAll(w.workspaceId, owner.id);
});

const HOUR = 3_600_000;

async function create(
  body: Record<string, unknown>,
  user: KbWorld["owner"]["user"] = w.owner.user,
) {
  return w.agent(user, "/api/announcements", {
    method: "POST",
    body: {
      workspaceId: w.workspaceId,
      title: "Planned maintenance",
      body: "The service is read-only during the window.",
      severity: "maintenance",
      audience: "workspace",
      ...body,
    },
  });
}

async function createPublished(body: Record<string, unknown> = {}) {
  const created = await create(body);
  expect(created.status, await created.clone().text()).toBe(200);
  const draft = (await created.json()) as Announcement;
  const published = await w.agent(
    w.owner.user,
    `/api/announcements/${draft.id}/publish`,
    { method: "POST", body: { version: draft.version } },
  );
  expect(published.status).toBe(200);
  return (await published.json()) as Announcement;
}

/** `reachesAudience` of one notice for a staff user, from the list and from the detail. */
async function staffReachesAudience(
  user: KbWorld["owner"]["user"],
  id: string,
) {
  const listed = await w.agent(
    user,
    `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`,
  );
  expect(listed.status).toBe(200);
  const row = ((await listed.json()) as { data: Announcement[] }).data.find(
    (entry) => entry.id === id,
  );
  const detail = await w.agent(user, `/api/announcements/${id}`);
  expect(detail.status).toBe(200);
  const fromDetail = ((await detail.json()) as Announcement).reachesAudience;
  expect(row?.reachesAudience).toBe(fromDetail);
  return fromDetail;
}

async function portalIds(customer: KbWorld["customerA"], query = "") {
  const response = await w.portal(
    customer.user,
    `/api/portal/announcements${query}`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  return body.data.map((row) => row.id);
}

async function portalTitle(customer: KbWorld["customerA"], id: string) {
  const response = await w.portal(
    customer.user,
    `/api/portal/announcements/${encodeURIComponent(id)}`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { title: string }).title;
}

async function portalDetailStatus(customer: KbWorld["customerA"], id: string) {
  return (
    await w.portal(
      customer.user,
      `/api/portal/announcements/${encodeURIComponent(id)}`,
    )
  ).status;
}

describe("staff permissions", () => {
  it("lets owner, admin and manager manage announcements and refuses lead, member and viewer", async () => {
    const admin = await addMember(w.workspaceId, "admin");
    const manager = await addMember(w.workspaceId, "manager");
    const lead = await addMember(w.workspaceId, "lead");
    // A workspace-wide notice addresses every customer, so it needs reach to every project.
    await grantSeesAll(w.workspaceId, admin.personId);
    await grantSeesAll(w.workspaceId, manager.personId);
    for (const user of [w.owner.user, admin.user, manager.user]) {
      expect((await create({}, user)).status).toBe(200);
      expect(
        (
          await w.agent(
            user,
            `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`,
          )
        ).status,
      ).toBe(200);
    }
    const published = await createPublished();
    for (const user of [lead.user, w.member.user, w.viewer.user]) {
      expect((await create({}, user)).status).toBe(403);
      expect(
        (
          await w.agent(
            user,
            `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await w.agent(user, `/api/announcements/${published.id}`, {
            method: "PATCH",
            body: { version: published.version, title: "Changed" },
          })
        ).status,
      ).toBe(403);
    }
  });

  it("does not open staff routes to a customer", async () => {
    const announcement = await createPublished();
    mockAuthenticatedSession(w.customerA.user, { portal: "customer" });
    // A customer-portal session is not a staff session: every staff route answers 401.
    for (const [method, path, body] of [
      [
        "GET",
        `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`,
        undefined,
      ],
      ["GET", `/api/announcements/${announcement.id}`, undefined],
      [
        "POST",
        "/api/announcements",
        {
          workspaceId: w.workspaceId,
          title: "From a customer",
          body: "Not allowed.",
          severity: "info",
          audience: "workspace",
        },
      ],
      [
        "POST",
        `/api/announcements/${announcement.id}/unpublish`,
        { version: announcement.version },
      ],
    ] as const) {
      const response = await w.app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("answers 409 feature_disabled while the service catalogue is off", async () => {
    await setServiceFlag(w.workspaceId, false);
    const response = await create({});
    expect(response.status).toBe(409);
  });
});

describe("audience isolation", () => {
  it("shows a workspace announcement to every customer organisation with a live project there", async () => {
    const announcement = await createPublished();
    expect(await portalIds(w.customerA)).toEqual([announcement.id]);
    expect(await portalIds(w.customerB)).toEqual([announcement.id]);
  });

  it("shows an organisation announcement to that organisation only", async () => {
    const announcement = await createPublished({
      audience: "organisations",
      organisationIds: [w.customerA.orgId],
    });
    expect(announcement.organisations.map((entry) => entry.id)).toEqual([
      w.customerA.orgId,
    ]);
    expect(await portalIds(w.customerA)).toEqual([announcement.id]);
    expect(await portalIds(w.customerB)).toEqual([]);
    expect(await portalDetailStatus(w.customerA, announcement.id)).toBe(200);
    expect(await portalDetailStatus(w.customerB, announcement.id)).toBe(404);
  });

  it("shows a project announcement to the organisation of that project only", async () => {
    const announcement = await createPublished({
      audience: "projects",
      projectIds: [w.projectB.id],
    });
    expect(await portalIds(w.customerB)).toEqual([announcement.id]);
    expect(await portalIds(w.customerA)).toEqual([]);
    expect(await portalDetailStatus(w.customerA, announcement.id)).toBe(404);
  });

  it("hides an organisation announcement once the organisation has no live project in the workspace", async () => {
    const announcement = await createPublished({
      audience: "organisations",
      organisationIds: [w.customerA.orgId],
    });
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect(await portalDetailStatus(w.customerA, announcement.id)).toBe(404);
  });

  it("refuses audience targets outside the workspace", async () => {
    const stranger = await createCustomerPrincipal();
    expect(
      (
        await create({
          audience: "organisations",
          organisationIds: [stranger.orgId],
        })
      ).status,
    ).toBe(422);
    const other = await createWorkspaceMember({ role: "owner" });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: w.customerA.orgId })
      .where(eq(schema.projectTable.id, foreignProject.id));
    expect(
      (await create({ audience: "projects", projectIds: [foreignProject.id] }))
        .status,
    ).toBe(422);
    expect(
      (await create({ audience: "organisations", organisationIds: [] })).status,
    ).toBe(422);
  });

  it("lists the workspace's customer organisations and projects as audience options", async () => {
    const response = await w.agent(
      w.owner.user,
      `/api/announcements/audience-options?workspaceId=${encodeURIComponent(w.workspaceId)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      canAddressWorkspace: boolean;
      organisations: Array<{ id: string }>;
      projects: Array<{ id: string; organisationId: string }>;
    };
    expect(body.canAddressWorkspace).toBe(true);
    expect(body.organisations.map((entry) => entry.id).sort()).toEqual(
      [w.customerA.orgId, w.customerB.orgId].sort(),
    );
    expect(body.projects.map((entry) => entry.id).sort()).toEqual(
      [w.projectA.id, w.projectB.id].sort(),
    );
  });
});

describe("project reach", () => {
  it("hides targeted projects outside a manager's reach and refuses adding them", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    const announcement = await createPublished({
      audience: "projects",
      projectIds: [w.projectA.id, w.projectB.id],
    });
    const listed = await w.agent(
      manager.user,
      `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`,
    );
    expect(listed.status).toBe(200);
    const rows = ((await listed.json()) as { data: Announcement[] }).data;
    expect(rows.find((row) => row.id === announcement.id)?.projects).toEqual([
      { id: w.projectA.id, name: w.projectA.name },
    ]);
    // The staff UI locks the notice from the flag; the owner reaches both customers.
    expect(await staffReachesAudience(manager.user, announcement.id)).toBe(
      false,
    );
    expect(await staffReachesAudience(w.owner.user, announcement.id)).toBe(
      true,
    );
    const options = await w.agent(
      manager.user,
      `/api/announcements/audience-options?workspaceId=${encodeURIComponent(w.workspaceId)}`,
    );
    const body = (await options.json()) as {
      canAddressWorkspace: boolean;
      organisations: Array<{ id: string }>;
      projects: Array<{ id: string }>;
    };
    expect(body.canAddressWorkspace).toBe(false);
    expect(body.projects.map((entry) => entry.id)).toEqual([w.projectA.id]);
    expect(body.organisations.map((entry) => entry.id)).toEqual([
      w.customerA.orgId,
    ]);
    expect(
      (
        await create(
          { audience: "projects", projectIds: [w.projectB.id] },
          manager.user,
        )
      ).status,
    ).toBe(422);
    // A published notice is live for Fabrikam too, so editing it needs reach to project B.
    const edited = await w.agent(
      manager.user,
      `/api/announcements/${announcement.id}`,
      {
        method: "PATCH",
        body: {
          version: announcement.version,
          title: "Edited by a manager",
          projectIds: [w.projectA.id],
        },
      },
    );
    expect(edited.status, await edited.clone().text()).toBe(422);
    expect(await portalIds(w.customerB)).toEqual([announcement.id]);
    expect(await portalTitle(w.customerB, announcement.id)).toBe(
      "Planned maintenance",
    );
    // A draft is not customer-facing: editing keeps the stored target the manager cannot see.
    const draft = (await (
      await create({
        audience: "projects",
        projectIds: [w.projectA.id, w.projectB.id],
      })
    ).json()) as Announcement;
    const draftEdit = await w.agent(
      manager.user,
      `/api/announcements/${draft.id}`,
      {
        method: "PATCH",
        body: {
          version: draft.version,
          title: "Edited by a manager",
          projectIds: [w.projectA.id],
        },
      },
    );
    expect(draftEdit.status, await draftEdit.clone().text()).toBe(200);
    const [stored] = await db
      .select({ projectId: announcementProjectTable.projectId })
      .from(announcementProjectTable)
      .where(
        and(
          eq(announcementProjectTable.announcementId, draft.id),
          eq(announcementProjectTable.projectId, w.projectB.id),
        ),
      );
    expect(stored?.projectId).toBe(w.projectB.id);
  });

  it("refuses changing a published workspace-wide notice past a manager's reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    await ensureAgentSession(manager.user.id);
    const live = await createPublished({ audience: "workspace" });
    const expired = await createPublished({
      audience: "workspace",
      startsAt: new Date(Date.now() - 2 * HOUR).toISOString(),
      endsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(await portalIds(w.customerB)).toEqual([live.id]);
    expect(await staffReachesAudience(manager.user, live.id)).toBe(false);
    expect(await staffReachesAudience(w.owner.user, live.id)).toBe(true);
    for (const [method, path, body] of [
      [
        "PATCH",
        `/api/announcements/${live.id}`,
        { version: live.version, title: "PROBE rewritten" },
      ],
      // Narrowing a live workspace-wide notice to the manager's own project also withdraws it.
      [
        "PATCH",
        `/api/announcements/${live.id}`,
        {
          version: live.version,
          audience: "projects",
          projectIds: [w.projectA.id],
        },
      ],
      [
        "PATCH",
        `/api/announcements/${expired.id}`,
        { version: expired.version, endsAt: null },
      ],
      [
        "POST",
        `/api/announcements/${live.id}/unpublish`,
        { version: live.version },
      ],
      ["DELETE", `/api/announcements/${live.id}`, undefined],
    ] as const) {
      const response = await w.agent(manager.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(422);
    }
    // Fabrikam still sees the original notice, and the expired one stays hidden.
    expect(await portalIds(w.customerB)).toEqual([live.id]);
    expect(await portalTitle(w.customerB, live.id)).toBe("Planned maintenance");
    expect(await portalDetailStatus(w.customerB, expired.id)).toBe(404);
    const pending = await db
      .select({ id: schema.pendingActionTable.id })
      .from(schema.pendingActionTable)
      .where(
        eq(schema.pendingActionTable.requestedByPersonId, manager.personId),
      );
    expect(pending).toEqual([]);
    // A draft workspace-wide notice is not customer-facing, so the same manager may edit it.
    const draft = (await (await create({})).json()) as Announcement;
    const draftEdit = await w.agent(
      manager.user,
      `/api/announcements/${draft.id}`,
      {
        method: "PATCH",
        body: { version: draft.version, title: "Draft edit" },
      },
    );
    expect(draftEdit.status, await draftEdit.clone().text()).toBe(200);
    // Positive control: with reach to every customer project the manager may edit and withdraw.
    await grantProjectRole(manager.user.id, w.projectB.id, ["project:read"]);
    expect(await staffReachesAudience(manager.user, live.id)).toBe(true);
    const edited = await w.agent(
      manager.user,
      `/api/announcements/${live.id}`,
      { method: "PATCH", body: { version: live.version, title: "Edited" } },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect((await edited.clone().json()).reachesAudience).toBe(true);
    expect(await portalTitle(w.customerB, live.id)).toBe("Edited");
    const withdrawn = await w.agent(
      manager.user,
      `/api/announcements/${live.id}/unpublish`,
      {
        method: "POST",
        body: { version: ((await edited.json()) as Announcement).version },
      },
    );
    expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
    expect(await portalIds(w.customerB)).toEqual([]);
  });

  it("refuses changing a published notice to organisations past a manager's reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    await ensureAgentSession(manager.user.id);
    const mixed = await createPublished({
      audience: "organisations",
      organisationIds: [w.customerA.orgId, w.customerB.orgId],
    });
    expect(await staffReachesAudience(manager.user, mixed.id)).toBe(false);
    for (const [method, path, body] of [
      [
        "PATCH",
        `/api/announcements/${mixed.id}`,
        { version: mixed.version, body: "PROBE body to Fabrikam" },
      ],
      [
        "POST",
        `/api/announcements/${mixed.id}/unpublish`,
        { version: mixed.version },
      ],
      ["DELETE", `/api/announcements/${mixed.id}`, undefined],
    ] as const) {
      const response = await w.agent(manager.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(422);
    }
    const detail = await w.portal(
      w.customerB.user,
      `/api/portal/announcements/${encodeURIComponent(mixed.id)}`,
    );
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { body: string }).body).toBe(
      "The service is read-only during the window.",
    );
    expect(await portalIds(w.customerB)).toEqual([mixed.id]);
    const [stored] = await db
      .select({ version: announcementTable.version })
      .from(announcementTable)
      .where(eq(announcementTable.id, mixed.id));
    expect(stored?.version).toBe(mixed.version);
  });

  it("refuses approving a published notice's deletion once the requester lost reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    await grantProjectRole(manager.user.id, w.projectB.id, ["project:read"]);
    await ensureAgentSession(manager.user.id);
    const announcement = await createPublished({ audience: "workspace" });
    const requested = await w.agent(
      manager.user,
      `/api/announcements/${announcement.id}`,
      { method: "DELETE" },
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, manager.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, w.projectB.id),
        ),
      );
    mockAuthenticatedSession(manager.user);
    const approved = await approvePendingDeletion(
      w.app,
      manager.user.id,
      await requested.json(),
    );
    expect(approved.status, await approved.clone().text()).toBe(409);
    const [row] = await db
      .select({ deletedAt: announcementTable.deletedAt })
      .from(announcementTable)
      .where(eq(announcementTable.id, announcement.id));
    expect(row?.deletedAt).toBeNull();
    expect(await portalIds(w.customerB)).toEqual([announcement.id]);
    const [action] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(
        eq(schema.pendingActionTable.requestedByPersonId, manager.personId),
      );
    // The refused approval rolls back: the action stays pending for the requester to cancel.
    expect(action?.state).toBe("pending");
  });

  it("answers a notice with no target in a manager's reach as missing", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    await ensureAgentSession(manager.user.id);
    const byProject = await createPublished({
      audience: "projects",
      projectIds: [w.projectB.id],
    });
    const byOrganisation = await createPublished({
      audience: "organisations",
      organisationIds: [w.customerB.orgId],
    });
    const visible = await createPublished({
      audience: "organisations",
      organisationIds: [w.customerA.orgId, w.customerB.orgId],
    });
    const listPath = `/api/announcements?workspaceId=${encodeURIComponent(w.workspaceId)}`;
    const listed = await w.agent(manager.user, listPath);
    expect(listed.status).toBe(200);
    const rows = ((await listed.json()) as { data: Announcement[] }).data;
    expect(rows.map((row) => row.id)).toEqual([visible.id]);
    // Fabrikam's name is project content outside the manager's reach.
    expect(rows[0]?.organisations).toEqual([
      { id: w.customerA.orgId, name: expect.any(String) },
    ]);
    const ownerRows = (
      (await (await w.agent(w.owner.user, listPath)).json()) as {
        data: Announcement[];
      }
    ).data.map((row) => row.id);
    expect(ownerRows.sort()).toEqual(
      [byProject.id, byOrganisation.id, visible.id].sort(),
    );
    for (const hidden of [byProject, byOrganisation]) {
      for (const [method, path, body] of [
        ["GET", `/api/announcements/${hidden.id}`, undefined],
        [
          "PATCH",
          `/api/announcements/${hidden.id}`,
          { version: hidden.version, title: "Edited past reach" },
        ],
        // A stale version still answers 404: the conflict must not confirm the row exists.
        [
          "PATCH",
          `/api/announcements/${hidden.id}`,
          { version: hidden.version + 7, title: "Edited past reach" },
        ],
        [
          "POST",
          `/api/announcements/${hidden.id}/publish`,
          { version: hidden.version },
        ],
        [
          "POST",
          `/api/announcements/${hidden.id}/unpublish`,
          { version: hidden.version },
        ],
        ["DELETE", `/api/announcements/${hidden.id}`, undefined],
      ] as const) {
        const response = await w.agent(manager.user, path, { method, body });
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    }
    // Nothing changed for Fabrikam.
    expect((await portalIds(w.customerB)).sort()).toEqual(
      [byProject.id, byOrganisation.id, visible.id].sort(),
    );
    const [stored] = await db
      .select({
        title: announcementTable.title,
        version: announcementTable.version,
      })
      .from(announcementTable)
      .where(eq(announcementTable.id, byProject.id));
    expect(stored).toEqual({
      title: "Planned maintenance",
      version: byProject.version,
    });
  });

  it("lets a manager delete a notice with a target in reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    await ensureAgentSession(manager.user.id);
    // Positive controls for both branches of the deletion reach hook (request and execution).
    for (const audience of [
      { audience: "projects", projectIds: [w.projectA.id] },
      { audience: "organisations", organisationIds: [w.customerA.orgId] },
    ]) {
      const announcement = await createPublished(audience);
      const requested = await w.agent(
        manager.user,
        `/api/announcements/${announcement.id}`,
        { method: "DELETE" },
      );
      expect(requested.status, await requested.clone().text()).toBe(202);
      mockAuthenticatedSession(manager.user);
      const approved = await approvePendingDeletion(
        w.app,
        manager.user.id,
        await requested.json(),
      );
      expect(approved.status, await approved.clone().text()).toBe(200);
      const [row] = await db
        .select({ deletedAt: announcementTable.deletedAt })
        .from(announcementTable)
        .where(eq(announcementTable.id, announcement.id));
      expect(row?.deletedAt, audience.audience).not.toBeNull();
    }
  });

  it("refuses widening an audience past a manager's reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    expect((await create({ audience: "workspace" }, manager.user)).status).toBe(
      422,
    );
    const mixed = await createPublished({
      audience: "projects",
      projectIds: [w.projectA.id, w.projectB.id],
    });
    for (const change of [
      { audience: "workspace" },
      { audience: "organisations", organisationIds: [w.customerA.orgId] },
    ]) {
      const response = await w.agent(
        manager.user,
        `/api/announcements/${mixed.id}`,
        { method: "PATCH", body: { version: mixed.version, ...change } },
      );
      expect(response.status, JSON.stringify(change)).toBe(422);
    }
    expect(await portalIds(w.customerA)).toEqual([mixed.id]);
    expect(await portalIds(w.customerB)).toEqual([mixed.id]);
    // An owner's workspace-wide draft is visible but cannot be published past reach.
    const draft = (await (await create({})).json()) as Announcement;
    const publish = await w.agent(
      manager.user,
      `/api/announcements/${draft.id}/publish`,
      { method: "POST", body: { version: draft.version } },
    );
    expect(publish.status).toBe(422);
    expect(await portalIds(w.customerB)).toEqual([mixed.id]);
    // With reach to every customer project the same manager may address everyone.
    await grantProjectRole(manager.user.id, w.projectB.id, ["project:read"]);
    expect((await create({ audience: "workspace" }, manager.user)).status).toBe(
      200,
    );
    const published = await w.agent(
      manager.user,
      `/api/announcements/${draft.id}/publish`,
      { method: "POST", body: { version: draft.version } },
    );
    expect(published.status).toBe(200);
  });

  it("refuses publishing a draft with targets past a manager's reach", async () => {
    const manager = await addMember(w.workspaceId, "manager");
    await grantProjectRole(manager.user.id, w.projectA.id, ["project:read"]);
    // A notice wholly inside the manager's reach stays theirs to publish and change.
    const own = (await (
      await create({ audience: "projects", projectIds: [w.projectA.id] })
    ).json()) as Announcement;
    expect(await staffReachesAudience(manager.user, own.id)).toBe(true);
    for (const audience of [
      {
        audience: "organisations",
        organisationIds: [w.customerA.orgId, w.customerB.orgId],
      },
      { audience: "projects", projectIds: [w.projectA.id, w.projectB.id] },
    ]) {
      const created = await create(audience);
      expect(created.status, await created.clone().text()).toBe(200);
      const draft = (await created.json()) as Announcement;
      // The staff UI disables Publish from the flag; the API refusal below is the rule.
      expect(
        await staffReachesAudience(manager.user, draft.id),
        audience.audience,
      ).toBe(false);
      const publish = await w.agent(
        manager.user,
        `/api/announcements/${draft.id}/publish`,
        { method: "POST", body: { version: draft.version } },
      );
      expect(publish.status, audience.audience).toBe(422);
      const [stored] = await db
        .select({ publishedAt: announcementTable.publishedAt })
        .from(announcementTable)
        .where(eq(announcementTable.id, draft.id));
      expect(stored?.publishedAt, audience.audience).toBeNull();
      expect(await portalIds(w.customerA)).toEqual([]);
      expect(await portalIds(w.customerB)).toEqual([]);
      // Positive control: the owner reaches every target and may publish the same draft.
      const byOwner = await w.agent(
        w.owner.user,
        `/api/announcements/${draft.id}/publish`,
        { method: "POST", body: { version: draft.version } },
      );
      expect(byOwner.status, audience.audience).toBe(200);
      expect(await portalIds(w.customerB)).toEqual([draft.id]);
      // Withdraw it again so the next audience starts from empty portal lists.
      const withdrawn = await w.agent(
        w.owner.user,
        `/api/announcements/${draft.id}/unpublish`,
        {
          method: "POST",
          body: { version: ((await byOwner.json()) as Announcement).version },
        },
      );
      expect(withdrawn.status).toBe(200);
    }
  });

  it("keeps a notice whose only project was deleted manageable by a sees-all owner", async () => {
    const announcement = await createPublished({
      audience: "projects",
      projectIds: [w.projectB.id],
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.projectB.id));
    const response = await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}`,
    );
    expect(response.status).toBe(200);
  });
});

describe("drafts and the time window", () => {
  it("hides drafts, future and expired announcements and filters by severity", async () => {
    const draft = (await (await create({})).json()) as Announcement;
    const future = await createPublished({
      startsAt: new Date(Date.now() + HOUR).toISOString(),
    });
    const expired = await createPublished({
      startsAt: new Date(Date.now() - 3 * HOUR).toISOString(),
      endsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    const live = await createPublished({
      severity: "incident",
      startsAt: new Date(Date.now() - HOUR).toISOString(),
      endsAt: new Date(Date.now() + HOUR).toISOString(),
    });
    const info = await createPublished({ severity: "info" });
    expect((await portalIds(w.customerA)).sort()).toEqual(
      [live.id, info.id].sort(),
    );
    for (const hidden of [draft, future, expired])
      expect(await portalDetailStatus(w.customerA, hidden.id)).toBe(404);
    expect(
      await portalIds(w.customerA, "?severity=incident,maintenance"),
    ).toEqual([live.id]);
    expect(
      (
        await w.portal(
          w.customerA.user,
          "/api/portal/announcements?severity=urgent",
        )
      ).status,
    ).toBe(400);
  });

  it("withdraws an unpublished announcement from the portal", async () => {
    const announcement = await createPublished();
    const response = await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}/unpublish`,
      { method: "POST", body: { version: announcement.version } },
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as Announcement).publishedAt).toBeNull();
    expect(await portalIds(w.customerA)).toEqual([]);
  });

  it("refuses an end before the start", async () => {
    const response = await create({
      startsAt: new Date(Date.now()).toISOString(),
      endsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(response.status).toBe(422);
  });

  it("hides announcements of a workspace with the customer portal off", async () => {
    await createPublished();
    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: w.workspaceId,
      featureKey: "feature.customer_portal",
      enabled: false,
    });
    invalidateFeatureFlagCache();
    const response = await w.portal(
      w.customerA.user,
      "/api/portal/announcements",
    );
    // The organisation's only workspace has the portal off: the feature-off gate answers 404.
    expect(response.status).toBe(404);
  });
});

describe("workspace isolation", () => {
  it("answers 404 to staff of another workspace and keeps its announcements from foreign customers", async () => {
    const announcement = await createPublished();
    const other = await createWorkspaceMember({ role: "owner" });
    await setServiceFlag(other.workspace.id, true);
    for (const [method, path, body] of [
      ["GET", `/api/announcements/${announcement.id}`, undefined],
      [
        "PATCH",
        `/api/announcements/${announcement.id}`,
        { version: announcement.version, title: "Hijacked" },
      ],
      [
        "POST",
        `/api/announcements/${announcement.id}/unpublish`,
        { version: announcement.version },
      ],
      ["DELETE", `/api/announcements/${announcement.id}`, undefined],
    ] as const) {
      const response = await w.agent(other.user, path, { method, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // A customer whose organisation has no project in the workspace sees nothing.
    const stranger = await createCustomerPrincipal();
    expect(await portalIds(stranger)).toEqual([]);
    expect(await portalDetailStatus(stranger, announcement.id)).toBe(404);
  });
});

describe("concurrency, audit and deletion", () => {
  it("refuses a stale version with 409 and audits every change", async () => {
    const announcement = await createPublished();
    const updated = await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}`,
      {
        method: "PATCH",
        body: { version: announcement.version, title: "Maintenance moved" },
      },
    );
    expect(updated.status).toBe(200);
    const stale = await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}`,
      {
        method: "PATCH",
        body: { version: announcement.version, title: "Lost update" },
      },
    );
    expect(stale.status).toBe(409);
    const current = (await updated.json()) as Announcement;
    await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}/unpublish`,
      { method: "POST", body: { version: current.version } },
    );
    const actions = await auditActions(w.workspaceId);
    for (const action of [
      "announcement.created",
      "announcement.published",
      "announcement.updated",
      "announcement.unpublished",
    ])
      expect(actions).toContain(action);
  });

  it("deletes through a pending action and then hides the announcement everywhere", async () => {
    const announcement = await createPublished();
    await ensureAgentSession(w.owner.user.id);
    const requested = await w.agent(
      w.owner.user,
      `/api/announcements/${announcement.id}`,
      { method: "DELETE" },
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    const pending = await requested.json();
    const [untouched] = await db
      .select({ deletedAt: announcementTable.deletedAt })
      .from(announcementTable)
      .where(eq(announcementTable.id, announcement.id));
    expect(untouched?.deletedAt).toBeNull();
    mockAuthenticatedSession(w.owner.user);
    const approved = await approvePendingDeletion(
      w.app,
      w.owner.user.id,
      pending,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    const [row] = await db
      .select({ deletedAt: announcementTable.deletedAt })
      .from(announcementTable)
      .where(
        and(
          eq(announcementTable.id, announcement.id),
          eq(announcementTable.workspaceId, w.workspaceId),
        ),
      );
    expect(row?.deletedAt).not.toBeNull();
    expect(await portalIds(w.customerA)).toEqual([]);
    expect(
      (await w.agent(w.owner.user, `/api/announcements/${announcement.id}`))
        .status,
    ).toBe(404);
    expect(await auditActions(w.workspaceId)).toContain("announcement.deleted");
  });
});
