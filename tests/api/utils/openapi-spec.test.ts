import { describe, expect, it } from "vitest";
import { normalizeApiServerUrl } from "../../../apps/api/src/utils/openapi-spec";

describe("normalizeApiServerUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(normalizeApiServerUrl("https://taskdesk.example.com")).toBe(
      "https://taskdesk.example.com/api",
    );
  });

  it("leaves a URL that already ends with /api alone", () => {
    expect(normalizeApiServerUrl("https://taskdesk.example.com/api")).toBe(
      "https://taskdesk.example.com/api",
    );
  });

  it("strips trailing slashes before appending", () => {
    expect(normalizeApiServerUrl("https://taskdesk.example.com///")).toBe(
      "https://taskdesk.example.com/api",
    );
    expect(normalizeApiServerUrl("https://taskdesk.example.com/api/")).toBe(
      "https://taskdesk.example.com/api",
    );
  });
});
