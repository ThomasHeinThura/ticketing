/**
 * #359: the assignee picker and the write path use one roster rule (`rosterWhere`), so a
 * stray customer-side or placeholder membership row is hidden by the picker AND refused on
 * assignment. Inactive people stay on the roster for the write's `not_active` reason.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resolveAssigneeEligibility } from "../../apps/api/src/work-item/assignee-eligibility";
import { listAssignablePeople } from "../../apps/api/src/work-item/controllers/list-assignable-people";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

async function rostered(
  projectId: string,
  roleId: string,
  values: { side?: string; isPlaceholder?: boolean; active?: boolean },
) {
  const organisation = await ensureInternalOrganisation();
  const person = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        organisationId: organisation.id,
        side: "staff",
        ...values,
      })
      .returning(),
    "person",
  );
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId,
  });
  return person.id;
}

describe("assignee roster parity (#359)", () => {
  it("hides and refuses customer-side and placeholder people identically", async () => {
    const actor = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "project",
          key: `role-${randomUUID()}`,
          name: "Project Member",
          rank: 1,
        })
        .returning(),
      "role",
    );
    const staff = await rostered(project.id, role.id, {});
    const customer = await rostered(project.id, role.id, { side: "customer" });
    const placeholder = await rostered(project.id, role.id, {
      isPlaceholder: true,
    });
    const inactive = await rostered(project.id, role.id, { active: false });

    const picker = await listAssignablePeople({
      projectId: project.id,
      workspaceId: actor.workspace.id,
      callerPersonId: null,
      callerCanAssignAnyone: true,
      callerCanSelfAssign: false,
    });
    expect(picker.map((p) => p.personId)).toEqual([staff]);

    expect(await resolveAssigneeEligibility(db, project.id, staff)).toEqual({
      eligible: true,
    });
    for (const id of [customer, placeholder])
      expect(await resolveAssigneeEligibility(db, project.id, id)).toEqual({
        eligible: false,
        reason: "not_on_roster",
      });
    expect(await resolveAssigneeEligibility(db, project.id, inactive)).toEqual({
      eligible: false,
      reason: "not_active",
    });
  });
});
