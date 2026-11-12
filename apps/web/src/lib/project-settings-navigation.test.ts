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

  it("offers Budget for either budget read or time settings access", () => {
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
    const timeOnly = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: false,
      canReadBudgets: false,
      canLogTime: true,
    });
    expect(timeOnly.map(({ segment }) => segment)).toContain("budget");
    const settingsOnly = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: true,
      canReadBudgets: false,
    });
    expect(settingsOnly.map(({ segment }) => segment)).not.toContain("budget");
  });

  it("offers the readable estimates page without management rights", () => {
    const items = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: false,
      canReadEstimates: true,
    });
    expect(items.map(({ segment }) => segment)).toContain("estimates");
    expect(items.map(({ segment }) => segment)).not.toContain("features");
  });

  it("offers features for a project-only settings grant without changing automations", () => {
    const items = getProjectSettingsMenuItems((key) => key, {
      canManageProjectSettings: false,
      canManageFeatures: true,
    });
    expect(items.map(({ segment }) => segment)).toContain("features");
    expect(items.map(({ segment }) => segment)).not.toContain("automations");
  });
});
