import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import { findLabelById } from "../repository";

async function getLabel(identity: ResolvedIdentity, id: string) {
  const label = await findLabelById(identity, id);

  if (!label) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  return label;
}

export default getLabel;
