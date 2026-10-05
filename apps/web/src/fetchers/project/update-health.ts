import { client } from "@taskdesk/libs";

export async function updateProjectHealth(
  id: string,
  health: "red" | "amber" | "green" | null,
) {
  const response = await client.project[":id"].health.$patch({
    param: { id },
    json: { health },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
