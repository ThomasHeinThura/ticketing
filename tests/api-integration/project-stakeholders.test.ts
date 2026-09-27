/**
 * Issue #25's bounded slice: `docs/03-features/projects-and-engagements.md`'s
 * stakeholder routes ("a person, a role, an escalation order and a wait interval" --
 * `PR-12`: stood down, never deleted).
 */
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function makeStaffPerson() {
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "staff",
        isPlaceholder: true,
      })
      .returning(),
    "makeStaffPerson",
  );
}

async function listStakeholders(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/stakeholders`);
}

async function addStakeholder(projectId: string, body: unknown) {
  const { app } = createApp();
  return app.request(`/api/project/${projectId}/stakeholders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function standDownStakeholder(projectId: string, stakeholderId: string) {
  const { app } = createApp();
  return app.request(
    `/api/project/${projectId}/stakeholders/${stakeholderId}/stand-down`,
    { method: "POST" },
  );
}

describe("API integration: project stakeholders", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("404s adding a stakeholder for a person that doesn't exist", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: "person-missing",
      role: "Escalation contact",
      escalationOrder: 1,
    });

    expect(response.status).toBe(404);
  });

  it("adds, lists, stands down (never deletes) a stakeholder", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = await makeStaffPerson();
    mockAuthenticatedSession(member.user);

    const addResponse = await addStakeholder(project.id, {
      personId: person.id,
      role: "Escalation contact",
      escalationOrder: 1,
      escalationWaitMinutes: 15,
    });
    expect(addResponse.status).toBe(200);
    const added = (await addResponse.json()) as {
      id: string;
      active: boolean;
      escalationWaitMinutes: number;
    };
    expect(added.active).toBe(true);
    expect(added.escalationWaitMinutes).toBe(15);

    const listResponse = await listStakeholders(project.id);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    expect(listed.map((s) => s.id)).toEqual([added.id]);

    const standDownResponse = await standDownStakeholder(project.id, added.id);
    expect(standDownResponse.status).toBe(200);
    const standedDown = (await standDownResponse.json()) as {
      active: boolean;
    };
    expect(standedDown.active).toBe(false);

    // PR-12: never deleted -- still present in the row store.
    const stillListed = await listStakeholders(project.id);
    const stillListedBody = (await stillListed.json()) as Array<{
      id: string;
      active: boolean;
    }>;
    expect(stillListedBody).toHaveLength(1);
    expect(stillListedBody[0]?.active).toBe(false);
  });

  it("rejects adding a stakeholder from a role without project:update", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = await makeStaffPerson();
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: person.id,
      role: "Escalation contact",
      escalationOrder: 1,
    });

    expect(response.status).toBe(403);
  });
});
