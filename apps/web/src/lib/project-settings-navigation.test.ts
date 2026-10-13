import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { getProjectSettingsMenuItems } from "./project-settings-navigation";

describe("project settings navigation", () => {
  it("only links to implemented documented routes", () => {
    const items = getProjectSettingsMenuItems((key) => key);
    expect(items.map(({ segment }) => segment)).toEqual([
      "general",
      "workflow",
    ]);
    for (const { segment } of items) {
      expect(generatedRouteMetadata.agent).toContain(
        `/dashboard/settings/projects/$projectId/${segment}`,
      );
    }
  });
});
