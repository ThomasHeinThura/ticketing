/**
 * UAT re-audit, 3 Nov (reports):
 *
 * - `createSavedViews` in `GET /api/capabilities` equals what `POST /api/views` enforces
 *   (saved_view:create, held through saved_view:share too), for every built-in workspace role,
 *   so the report builder never offers a viewer a save the API refuses with 403.
 * - `GET /api/reports/{key}` carries the organisation filter's choices over the caller's report
 *   reach (RP-7, RP-17): no role needs project:create to filter a report by organisation, and no
 *   caller learns an organisation outside its reach, outside the workspace, or the internal one.
 */
import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES, expandCapabilities } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  type ReportsWorld,
  reportsWorld,
  setFeature,
} from "./helpers/p5-reports";

beforeEach(async () => {
  await resetTestDatabase();
});

const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "manager",
  "lead",
  "member",
  "viewer",
] as const;

describe("createSavedViews matches POST /api/views for every built-in role", () => {
  for (const role of WORKSPACE_ROLES) {
    it(`${role}`, async () => {
      const expected = expandCapabilities(
        BUILT_IN_ROLES[role].capabilities,
      ).has("saved_view:create");
      const member = await createWorkspaceMember({ role });
      const workspaceId = member.workspace.id;
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const caps = await app.request(
        `/api/capabilities?workspaceId=${workspaceId}`,
      );
      expect(caps.status).toBe(200);
      const flags = (await caps.json()) as Record<string, boolean>;
      expect(flags.createSavedViews === true, "capability flag").toBe(expected);

      const created = await app.request("/api/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          name: `Report ${role}`,
          scope: "workspace",
          scopeId: workspaceId,
          visibility: "private",
          layout: "chart",
          query: { entity: "work_item" },
        }),
      });
      if (expected) expect(created.status, "create route").toBeLessThan(300);
      else expect(created.status, "create route").toBe(403);
    });
  }

  it("reports a viewer false and a lead true (saved_view:share implies create)", async () => {
    for (const [role, expected] of [
      ["viewer", false],
      ["lead", true],
    ] as const) {
      const member = await createWorkspaceMember({ role });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const response = await app.request(
        `/api/capabilities?workspaceId=${member.workspace.id}`,
      );
      const flags = (await response.json()) as Record<string, boolean>;
      expect(flags.createSavedViews, role).toBe(expected);
    }
  });
});

async function organisation(name: string, isInternal = false) {
  const id = `org-${randomUUID()}`;
  await db.insert(schema.organisationTable).values({
    id,
    key: id,
    name,
    isInternal,
  });
  return id;
}

async function bind(projectId: string, organisationId: string) {
  await db
    .update(schema.projectTable)
    .set({ organisationId })
    .where(eq(schema.projectTable.id, projectId));
}

type Choice = { id: string; name: string };

async function organisationsOf(
  w: ReportsWorld,
  user: Parameters<ReportsWorld["report"]>[0],
) {
  const { response, body } = await w.report(user, "sla_attainment");
  expect(response.status).toBe(200);
  return ((body as unknown as { organisations?: Choice[] }).organisations ??
    null) as Choice[] | null;
}

describe("report organisation filter choices (RP-7, RP-17)", () => {
  let w: ReportsWorld;
  let orgA: string;
  let orgB: string;
  let internalOrgId: string;
  let strangerOrg: string;

  beforeEach(async () => {
    w = await reportsWorld();
    // Project A already serves the customer principal's organisation; project B (owner only)
    // serves another; a third project serves the internal organisation.
    orgA = w.customer.orgId;
    orgB = await organisation("Beta Holdings");
    await bind(w.projectB.id, orgB);
    const [existingInternal] = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true));
    internalOrgId =
      existingInternal?.id ?? (await organisation("Internal", true));
    const { project: internalProject } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    await bind(internalProject.id, internalOrgId);
    // Another workspace's project serves an organisation nobody here should learn.
    strangerOrg = await organisation("Stranger Co");
    await bind(w.strangerProject.id, strangerOrg);
  });

  it("gives a viewer, a member and a lead the organisations of the projects they reach", async () => {
    for (const user of [w.viewer.user, w.member.user, w.lead.user]) {
      const choices = await organisationsOf(w, user);
      expect(choices?.map((choice) => choice.id)).toEqual([orgA]);
    }
  });

  it("gives report:read_all the whole workspace, never the internal or another workspace's organisation", async () => {
    const choices = await organisationsOf(w, w.owner.user);
    const ids = choices?.map((choice) => choice.id) ?? [];
    expect(ids.sort()).toEqual([orgA, orgB].sort());
    expect(ids).not.toContain(internalOrgId);
    expect(ids).not.toContain(strangerOrg);
  });

  it("gives a member who reaches no project an empty list, not a refusal", async () => {
    expect(await organisationsOf(w, w.outsider.user)).toEqual([]);
  });

  it("drops a deleted organisation", async () => {
    await db
      .update(schema.organisationTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.organisationTable.id, orgA));
    expect(await organisationsOf(w, w.member.user)).toEqual([]);
  });

  it("still refuses a customer (403) and answers 409 with Reports off", async () => {
    const customer = await w.report(w.customer.user, "sla_attainment");
    expect(customer.response.status).toBe(403);
    await setFeature(w.workspaceId, "feature.reports", false);
    const off = await w.report(w.member.user, "sla_attainment");
    expect(off.response.status).toBe(409);
  });

  it("keeps listing every reachable organisation while one is the active filter", async () => {
    const { response, body } = await w.report(
      w.owner.user,
      "sla_attainment",
      `&organisationId=${orgB}`,
    );
    expect(response.status).toBe(200);
    const ids = (
      (body as unknown as { organisations?: Choice[] }).organisations ?? []
    ).map((choice) => choice.id);
    expect(ids.sort()).toEqual([orgA, orgB].sort());
  });
});
