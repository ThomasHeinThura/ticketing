import { describe, expect, it } from "vitest";
import {
  hasPreferenceMarker,
  type PreferenceMarkerStorage,
  reconcilePreference,
  setPreferenceMarker,
} from "./user-preference-sync";

function memoryStorage(): PreferenceMarkerStorage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("reconcilePreference (views.md PREF-8)", () => {
  const base = {
    serverValue: undefined as unknown,
    localValue: "compact" as unknown,
    localIsDefault: false,
    migrated: false,
    dirty: false,
  };

  it("uploads an existing non-default local value once when the server has none", () => {
    expect(reconcilePreference(base)).toBe("push-local");
    expect(reconcilePreference({ ...base, migrated: true })).toBe("none");
  });

  it("does not upload a default local value, which could clobber another device", () => {
    expect(
      reconcilePreference({
        ...base,
        localValue: "comfortable",
        localIsDefault: true,
      }),
    ).toBe("none");
  });

  it("lets the server value win over the cache", () => {
    expect(reconcilePreference({ ...base, serverValue: "comfortable" })).toBe(
      "adopt-server",
    );
    expect(
      reconcilePreference({
        ...base,
        serverValue: "comfortable",
        migrated: true,
      }),
    ).toBe("adopt-server");
  });

  it("pushes a dirty local value instead of adopting the older server value", () => {
    expect(
      reconcilePreference({ ...base, serverValue: "comfortable", dirty: true }),
    ).toBe("push-local");
  });
});

describe("preference markers", () => {
  it("are per user, per key and per scope id, and tolerate missing storage", () => {
    const storage = memoryStorage();
    setPreferenceMarker(
      storage,
      "migrated",
      "u1",
      "project.layout",
      true,
      "p1",
    );
    expect(
      hasPreferenceMarker(storage, "migrated", "u1", "project.layout", "p1"),
    ).toBe(true);
    expect(
      hasPreferenceMarker(storage, "migrated", "u2", "project.layout", "p1"),
    ).toBe(false);
    expect(
      hasPreferenceMarker(storage, "migrated", "u1", "project.layout", "p2"),
    ).toBe(false);
    expect(
      hasPreferenceMarker(storage, "dirty", "u1", "project.layout", "p1"),
    ).toBe(false);
    setPreferenceMarker(
      storage,
      "migrated",
      "u1",
      "project.layout",
      false,
      "p1",
    );
    expect(
      hasPreferenceMarker(storage, "migrated", "u1", "project.layout", "p1"),
    ).toBe(false);
    expect(hasPreferenceMarker(undefined, "dirty", "u1", "k")).toBe(false);
    expect(() =>
      setPreferenceMarker(undefined, "dirty", "u1", "k", true),
    ).not.toThrow();
  });
});
