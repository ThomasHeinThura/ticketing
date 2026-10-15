import { HTTPException } from "hono/http-exception";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  type CannedResponseChanges,
  updateCannedResponseInWorkspace,
} from "../repository";

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
  const values: CannedResponseChanges = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.body !== undefined) values.body = input.body;
  if (input.visibilityDefault !== undefined) {
    values.visibilityDefault = input.visibilityDefault;
  }

  try {
    const updated = await updateCannedResponseInWorkspace(
      id,
      workspaceId,
      values,
    );

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
