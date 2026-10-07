import { HTTPException } from "hono/http-exception";
import { getLabelQuery } from "../repository";

async function getLabel(id: string) {
  const label = await getLabelQuery(id);

  if (!label) {
    throw new HTTPException(404, {
      message: "Label not found",
    });
  }

  return label;
}

export default getLabel;
