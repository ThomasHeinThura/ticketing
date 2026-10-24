import { describe, expect, it } from "vitest";
import { generatedRouteMetadata } from "./generated-route-metadata";
import { getProjectSettingsMenuItems } from "./project-settings-navigation";

describe("project settings navigation", () => {
  it("only links to implemented documented routes", () => {
    const items = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: true,
      canReadBudgets: true,
    });
    expect(items.map(({ segment }) => segment)).toEqual([
      "general",
      "members",
      "labels",
      "workflow",
      "features",
      "automations",
      "estimates",
      "budget",
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

  it("gates Budget on budget:read alone, independent of project settings rights", () => {
    const budgetOnly = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: false,
      canReadBudgets: true,
    });
    expect(budgetOnly.map(({ segment }) => segment)).toEqual([
      "general",
      "members",
      "labels",
      "workflow",
      "budget",
    ]);
    const settingsOnly = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: true,
      canReadBudgets: false,
    });
    expect(settingsOnly.map(({ segment }) => segment)).not.toContain("budget");
  });
});
