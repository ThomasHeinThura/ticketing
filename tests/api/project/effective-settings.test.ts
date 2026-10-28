import { describe, expect, it } from "vitest";
import {
  resolveProjectServiceCalendarId,
  resolveProjectSetting,
  resolveProjectSlaPolicyId,
} from "../../../apps/api/src/project/effective-settings";

describe("project setting inheritance", () => {
  it("uses workspace values only when the project mode is inherit", () => {
    const input = {
      mode: "inherit" as const,
      overrideId: null,
      workspaceDefaultId: "workspace-value",
    };
    expect(resolveProjectSetting(input)).toEqual({
      mode: "inherit",
      overrideId: null,
      effectiveId: "workspace-value",
      source: "workspace",
    });
    expect(resolveProjectSlaPolicyId(input)).toBe("workspace-value");
    expect(resolveProjectServiceCalendarId(input)).toBe("workspace-value");
  });

  it("keeps an explicit null override distinct from inheritance", () => {
    const input = {
      mode: "override" as const,
      overrideId: null,
      workspaceDefaultId: "workspace-value",
    };
    expect(resolveProjectSetting(input)).toEqual({
      mode: "override",
      overrideId: null,
      effectiveId: null,
      source: "none",
    });
    expect(resolveProjectSlaPolicyId(input)).toBeNull();
    expect(resolveProjectServiceCalendarId(input)).toBeNull();
  });

  it("keeps a concrete project override when the workspace default changes", () => {
    expect(
      resolveProjectSetting({
        mode: "override",
        overrideId: "project-value",
        workspaceDefaultId: "new-workspace-value",
      }),
    ).toEqual({
      mode: "override",
      overrideId: "project-value",
      effectiveId: "project-value",
      source: "project",
    });
  });

  it("represents an unset inherited workspace value without fabricating a source", () => {
    expect(
      resolveProjectSetting({
        mode: "inherit",
        overrideId: null,
        workspaceDefaultId: null,
      }),
    ).toEqual({
      mode: "inherit",
      overrideId: null,
      effectiveId: null,
      source: "none",
    });
  });
});
