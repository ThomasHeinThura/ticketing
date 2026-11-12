import { describe, expect, it } from "vitest";
import {
  browserWindowOrigin,
  legacyWindowOrigin,
  validWindowId,
} from "../../../apps/api/src/ws/window-id";

describe("window correlation input", () => {
  it.each([
    undefined,
    "",
    "a".repeat(65),
    "space id",
    "a:b",
    "a/b",
    "a\n",
    "é",
    "a.b",
  ])("ignores invalid value %s on both header and socket", (value) => {
    expect(validWindowId(value)).toBeUndefined();
    expect(browserWindowOrigin("user-1", value, true)).toBeUndefined();
    expect(legacyWindowOrigin("user-1", value)).toBeUndefined();
  });
  it.each(["a", "window-1", "tab_ABC123", "a".repeat(64)])(
    "accepts a bounded identifier %s",
    (value) => {
      expect(validWindowId(value)).toBe(value);
      expect(browserWindowOrigin("user-1", value, true)).toEqual({
        userId: "user-1",
        windowId: value,
      });
      expect(legacyWindowOrigin("user-1", value)).toBe(`user-1:${value}`);
      expect(browserWindowOrigin("user-1", value, false)).toBeUndefined();
    },
  );
});
