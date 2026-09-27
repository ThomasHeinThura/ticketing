import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cannedResponseTable } from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";

export type UpdateCannedResponseInput = {
  name?: string;
  body?: unknown;
  visibilityDefault?: "public" | "internal";
};

export async function updateCannedResponse(
  id: string,
  workspaceId: string,
  input: UpdateCannedResponseInput,
) {
  const values: Partial<typeof cannedResponseTable.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.body !== undefined) values.body = input.body;
  if (input.visibilityDefault !== undefined) {
    values.visibilityDefault = input.visibilityDefault;
  }

  try {
    const [updated] = await db
      .update(cannedResponseTable)
      .set(values)
      .where(
        and(
          eq(cannedResponseTable.id, id),
          eq(cannedResponseTable.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!updated) {
      throw new HTTPException(404, { message: "Canned response not found" });
    }

    return updated;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (isUniqueViolation(error, "canned_response_workspace_id_name_unique")) {
      throw new HTTPException(409, {
        message: "A canned response with this name already exists",
      });
    }
    throw error;
  }
}

export default updateCannedResponse;
