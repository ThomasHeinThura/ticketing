import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

/** Set (or clear, with null) a project's RAG health. Needs `project:update`; the server
 * answers 403 without it, surfaced here as an HttpError the caller can classify. */
export async function updateProjectHealth(
  id: string,
  health: "red" | "amber" | "green" | null,
) {
  const response = await client.project[":id"].health.$patch({
    param: { id },
    json: { health },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new HttpError(
      response.status,
      detail || "Failed to update project health",
    );
  }

  return response.json();
}

export default updateProjectHealth;
