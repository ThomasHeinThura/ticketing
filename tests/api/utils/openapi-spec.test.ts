import { describe, expect, it } from "vitest";
import { normalizeApiServerUrl } from "../../../apps/api/src/utils/openapi-spec";

describe("normalizeApiServerUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(normalizeApiServerUrl("https://cloud.taskdesk.app")).toBe(
      "https://cloud.taskdesk.app/api",
    );
  });

  it("leaves a URL that already ends with /api alone", () => {
    expect(normalizeApiServerUrl("https://cloud.taskdesk.app/api")).toBe(
      "https://cloud.taskdesk.app/api",
    );
  });

  it("strips trailing slashes before appending", () => {
    expect(normalizeApiServerUrl("https://cloud.taskdesk.app///")).toBe(
      "https://cloud.taskdesk.app/api",
    );
    expect(normalizeApiServerUrl("https://cloud.taskdesk.app/api/")).toBe(
      "https://cloud.taskdesk.app/api",
    );
  });
});
