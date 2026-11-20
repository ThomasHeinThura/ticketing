import { client } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";

export const projectOverviewKeys = {
  all: ["project-overview"] as const,
  overview: (projectId: string) =>
    ["project-overview", projectId, "overview"] as const,
  contract: (projectId: string) =>
    ["project-overview", projectId, "contract"] as const,
  milestones: (projectId: string) =>
    ["project-overview", projectId, "milestones"] as const,
  prerequisites: (projectId: string) =>
    ["project-overview", projectId, "prerequisites"] as const,
  stakeholders: (projectId: string) =>
    ["project-overview", projectId, "stakeholders"] as const,
  documentLinks: (projectId: string) =>
    ["project-overview", projectId, "document-links"] as const,
  roster: (projectId: string) =>
    ["project-overview", projectId, "roster"] as const,
};

export async function getProjectOverview(id: string) {
  const response = await client.project[":id"].overview.$get({
    param: { id },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      detail || "Failed to load the overview",
    );
  }
  return response.json();
}
