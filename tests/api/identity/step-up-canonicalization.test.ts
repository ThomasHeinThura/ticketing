import { describe, expect, it } from "vitest";
import { canonicalScimTokenBody } from "../../../apps/api/src/auth/step-up-service";

describe("SCIM token step-up canonical body", () => {
  it("hashes only the validated version body; route and operation stay in PA-15 columns", () => {
    expect(canonicalScimTokenBody(7).toString("utf8")).toBe('{"version":7}');
  });
});
