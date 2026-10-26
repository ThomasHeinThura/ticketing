import { describe, expect, it } from "vitest";
import { executeSavedViewQuery } from "../../apps/api/src/view/controllers/run-view";

describe("saved-view execution scope", () => {
  it("refuses a project-scoped submission query instead of widening to workspace scope", async () => {
    await expect(
      executeSavedViewQuery({
        workspaceId: "workspace-1",
        userId: "user-1",
        query: { entity: "submission" },
        limit: 50,
        projectScopeId: "project-1",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
