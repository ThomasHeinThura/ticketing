import { describe, expect, it } from "vitest";
import { normalizeApiServerUrl } from "../../../apps/api/src/utils/openapi-spec";

describe("normalizeApiServerUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(normalizeApiServerUrl("https://taskdesk.bimats.com")).toBe(
      "https://taskdesk.bimats.com/api",
    );
  });

  it("leaves a URL that already ends with /api alone", () => {
    expect(normalizeApiServerUrl("https://taskdesk.bimats.com/api")).toBe(
      "https://taskdesk.bimats.com/api",
    );
  });

  it("strips trailing slashes before appending", () => {
    expect(normalizeApiServerUrl("https://taskdesk.bimats.com///")).toBe(
      "https://taskdesk.bimats.com/api",
    );
    expect(normalizeApiServerUrl("https://taskdesk.bimats.com/api/")).toBe(
      "https://taskdesk.bimats.com/api",
    );
  });
});
