import { describe, expect, it } from "vitest";
import { getDefaultCommentVisibilityUpdate } from "./project-comment-visibility";

describe("getDefaultCommentVisibilityUpdate", () => {
  it("does not send the internal form fallback while project settings are loading", () => {
    expect(
      getDefaultCommentVisibilityUpdate({
        storedValue: undefined,
        settingsLoaded: false,
        nextValue: "internal",
        fieldDirty: false,
      }),
    ).toBeUndefined();
  });

  it("preserves a stored public default after a delayed settings response", () => {
    expect(
      getDefaultCommentVisibilityUpdate({
        storedValue: "public",
        settingsLoaded: true,
        nextValue: "internal",
        fieldDirty: false,
      }),
    ).toBeUndefined();
  });

  it("sends an explicit user change after settings have loaded", () => {
    expect(
      getDefaultCommentVisibilityUpdate({
        storedValue: "public",
        settingsLoaded: true,
        nextValue: "internal",
        fieldDirty: true,
      }),
    ).toBe("internal");
  });

  it("omits the field when the explicit value matches the stored value", () => {
    expect(
      getDefaultCommentVisibilityUpdate({
        storedValue: "public",
        settingsLoaded: true,
        nextValue: "public",
        fieldDirty: true,
      }),
    ).toBeUndefined();
  });
});
