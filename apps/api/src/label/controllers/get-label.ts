import { HTTPException } from "hono/http-exception";
import { findLabelById } from "../repository";

async function getLabel(id: string) {
  const label = await findLabelById(id);

  if (!label) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  return label;
}

export default getLabel;
