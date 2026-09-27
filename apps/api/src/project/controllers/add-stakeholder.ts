import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  personTable,
  stakeholderTable,
  workspaceTable,
} from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

export type AddStakeholderInput = {
  personId: string;
  role: string;
  escalationOrder: number;
  escalationWaitMinutes?: number;
};

async function addStakeholder(
  projectId: string,
  workspaceId: string,
  input: AddStakeholderInput,
) {
  await requireActiveProject(projectId, workspaceId);

  // Scoped to the CALLER'S organisation, not merely "this person id exists anywhere" --
  // `personTable.organisationId` and `workspaceTable.organisationId` are both NOT NULL
  // (#192), and without this join a caller holding `project:update` on one workspace
  // could attach a person from an entirely different organisation as a stakeholder.
  // Same shape `assign-work-item.ts` uses for its own roster check (a join scoped to the
  // resource's own tenant boundary), adapted here to organisation rather than project
  // membership, since a stakeholder need not be a project member.
  const [person] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.organisationId, personTable.organisationId),
    )
    .where(
      and(
        eq(personTable.id, input.personId),
        eq(workspaceTable.id, workspaceId),
      ),
    )
    .limit(1);

  if (!person) {
    throw new HTTPException(404, { message: "Person not found" });
  }

  const [created] = await db
    .insert(stakeholderTable)
    .values({
      projectId,
      personId: input.personId,
      role: input.role,
      escalationOrder: input.escalationOrder,
      escalationWaitMinutes: input.escalationWaitMinutes ?? 0,
    })
    .returning();

  return created;
}

export default addStakeholder;
