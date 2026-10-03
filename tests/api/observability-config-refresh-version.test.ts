import { describe, expect, it } from "vitest";
import { isNewerObservabilityConfig } from "../../apps/api/src/instance/observability/config-refresh-version";

describe("observability config refresh ordering", () => {
  it("does not let an older in-flight read overwrite a newer snapshot", () => {
    let appliedVersion = 4;

    const applyRefreshResult = (version: number) => {
      if (!isNewerObservabilityConfig(version, appliedVersion)) return false;
      appliedVersion = version;
      return true;
    };

    expect(applyRefreshResult(6)).toBe(true);
    expect(applyRefreshResult(5)).toBe(false);
    expect(appliedVersion).toBe(6);
  });

  it("accepts the next database version and ignores a duplicate", () => {
    expect(isNewerObservabilityConfig(5, 4)).toBe(true);
    expect(isNewerObservabilityConfig(4, 4)).toBe(false);
  });
});
