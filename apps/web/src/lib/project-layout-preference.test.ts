import { describe, expect, it } from "vitest";
import {
  readProjectLayoutPreference,
  writeProjectLayoutPreference,
} from "./project-layout-preference";

describe("per-project layout preference", () => {
  it("isolates the remembered layout by user and project", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeProjectLayoutPreference(storage, "user-1", "project-1", "list");

    expect(readProjectLayoutPreference(storage, "user-1", "project-1")).toBe(
      "list",
    );
    expect(readProjectLayoutPreference(storage, "user-1", "project-2")).toBe(
      undefined,
    );
    expect(readProjectLayoutPreference(storage, "user-2", "project-1")).toBe(
      undefined,
    );
    expect(readProjectLayoutPreference(storage, undefined, "project-1")).toBe(
      undefined,
    );
  });

  it("ignores invalid and unavailable storage values", () => {
    const storage = {
      getItem: () => "invalid",
      setItem: () => {
        throw new Error("unavailable");
      },
    };
    expect(readProjectLayoutPreference(storage, "user-1", "project-1")).toBe(
      undefined,
    );
    expect(() =>
      writeProjectLayoutPreference(storage, "user-1", "project-1", "board"),
    ).not.toThrow();
  });
});
