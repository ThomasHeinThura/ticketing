/**
 * Issue #25's bounded slice: `docs/03-features/projects-and-engagements.md`'s
 * stakeholder routes ("a person, a role, an escalation order and a wait interval" --
 * `PR-12`: stood down, never deleted).
 */
import { randomUUID } from "node:crypto";
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

/** A person belonging to a DIFFERENT organisation than the internal one every
 * `createWorkspaceMember` workspace lives in -- for the cross-organisation regression
 * test below. */
async function makePersonInAnotherOrganisation() {
  const now = new Date();
  const otherOrganisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `other-org-${randomUUID()}`,
        name: "Another Organisation",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makePersonInAnotherOrganisation: organisation",
  );

  return requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: otherOrganisation.id,
        side: "staff",
        isPlaceholder: true,
      })
      .returning(),
    "makePersonInAnotherOrganisation: person",
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

  it("404s adding a stakeholder from a person in a different organisation", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const outsider = await makePersonInAnotherOrganisation();
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: outsider.id,
      role: "Escalation contact",
      escalationOrder: 1,
    });

    expect(response.status).toBe(404);

    const listResponse = await listStakeholders(project.id);
    const listed = (await listResponse.json()) as unknown[];
    expect(listed).toHaveLength(0);
  });

  it("404s adding a stakeholder to a project belonging to another workspace", async () => {
    const memberA = await createWorkspaceMember({ role: "admin" });
    const memberB = await createWorkspaceMember({ role: "admin" });
    const { project: projectB } = await createProjectFixture({
      workspaceId: memberB.workspace.id,
    });
    mockAuthenticatedSession(memberA.user);

    const response = await addStakeholder(projectB.id, {
      role: "Escalation contact",
      escalationOrder: 1,
      personId: "irrelevant",
    });

    expect(response.status).toBe(400);
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

  it("rejects a NUL byte in role (S1, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = await makeStaffPerson();
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: person.id,
      role: "Bad\u0000role",
      escalationOrder: 1,
    });

    expect(response.status).toBe(400);
  });

  it("rejects a role exceeding the length limit (S3, Opus review of PR #438)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = await makeStaffPerson();
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: person.id,
      role: "a".repeat(101),
      escalationOrder: 1,
    });

    expect(response.status).toBe(400);
  });

  it("rejects an escalationOrder exceeding the database's integer column (S2, Opus review of PR #438, reproduced with 3000000000)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const person = await makeStaffPerson();
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: person.id,
      role: "Escalation contact",
      escalationOrder: 3_000_000_000,
    });

    expect(response.status).toBe(400);
  });

  it("rejects a NUL byte in personId", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await addStakeholder(project.id, {
      personId: "bad\u0000id",
      role: "Escalation contact",
      escalationOrder: 1,
    });

    expect(response.status).toBe(400);
  });
});
