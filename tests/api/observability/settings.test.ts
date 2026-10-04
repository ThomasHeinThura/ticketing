import { describe, expect, it } from "vitest";
import {
  defaultLogLevels,
  validateLogLevels,
} from "../../../apps/api/src/observability/settings.js";

describe("observability log-level settings", () => {
  it("provides the canonical safe defaults and accepts a partial module override", () => {
    expect(defaultLogLevels()).toEqual({
      default: "info",
      modules: {
        http: "info",
        auth: "info",
        database: "info",
        jobs: "info",
        audit: "info",
        plugins: "info",
        realtime: "info",
      },
    });
    expect(
      validateLogLevels({ default: "warn", modules: { http: "debug" } }),
    ).toEqual({ default: "warn", modules: { http: "debug" } });
  });

  it.each([
    [{ default: "info", modules: {}, extra: true }],
    [{ default: "trace", modules: {} }],
    [{ default: "info", modules: { unknown: "debug" } }],
    [{ default: "info", modules: { http: "trace" } }],
    [{ default: "info" }],
    [null],
  ])("rejects invalid persisted settings without coercion: %j", (value) => {
    expect(() => validateLogLevels(value)).toThrow(
      "Invalid observability log levels",
    );
  });
});
