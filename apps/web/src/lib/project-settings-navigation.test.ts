import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { getProjectSettingsMenuItems } from "./project-settings-navigation";

describe("project settings navigation", () => {
  it("only links to implemented documented routes", () => {
    const items = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: true,
    });
    expect(items.map(({ segment }) => segment)).toEqual([
      "general",
      "members",
      "labels",
      "workflow",
      "features",
      "automations",
    ]);
    for (const { segment } of items) {
      expect(generatedRouteMetadata.agent).toContain(
        `/dashboard/settings/projects/$projectId/${segment}`,
      );
    }
  });

  it("hides Features and Automations without project:manage_settings", () => {
    const items = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: false,
    });
    expect(items.map(({ segment }) => segment)).toEqual([
      "general",
      "members",
      "labels",
      "workflow",
    ]);
  });
});
