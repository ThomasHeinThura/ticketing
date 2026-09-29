import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cannedResponseTable } from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";

export type CreateCannedResponseInput = {
  workspaceId: string;
  name: string;
  body: unknown;
  visibilityDefault?: "public" | "internal";
  createdBy: string;
};

/**
 * `POST /api/canned-responses` (`CA-19`). `canned_response_workspace_id_name_unique`
 * (migration 0074) backs the name uniqueness within a workspace; a collision is answered
 * as a clean 409 rather than the raw constraint-violation 500, matching this codebase's
 * own convention (`create-work-item.ts`'s `work_item_key_claim_pkey` handling).
 */
export async function createCannedResponse(input: CreateCannedResponseInput) {
  try {
    const [created] = await db
      .insert(cannedResponseTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        body: input.body,
        visibilityDefault: input.visibilityDefault ?? "internal",
        createdBy: input.createdBy,
      })
      .returning();

    if (!created) {
      throw new HTTPException(500, {
        message: "Failed to create canned response",
      });
    }

    return created;
  } catch (error) {
    if (isUniqueViolation(error, "canned_response_workspace_id_name_unique")) {
      throw new HTTPException(409, {
        message: "A canned response with this name already exists",
      });
    }
    throw error;
  }
}

export default createCannedResponse;
