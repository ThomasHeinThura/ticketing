import { describe, expect, it } from "vitest";
import {
  apiKeyCapabilitySubset,
  apiKeyHasCapabilityScope,
  apiKeyScopeSatisfies,
} from "../../../apps/api/src/utils/require-api-key-permission-scope";

describe("API-key permission scope intersection", () => {
  const required = { project: ["create"] };

  it("leaves session requests to the role evaluator", () => {
    expect(apiKeyScopeSatisfies(undefined, required)).toBe(true);
  });

  it("requires the key to carry every requested resource/action grant", () => {
    expect(
      apiKeyScopeSatisfies(
        { permissions: { project: ["create", "read"] } },
        required,
      ),
    ).toBe(true);
    expect(
      apiKeyScopeSatisfies({ permissions: { project: ["read"] } }, required),
    ).toBe(false);
    expect(apiKeyScopeSatisfies({ permissions: {} }, required)).toBe(false);
  });

  it.each([
    ["SQL NULL", { permissions: null }],
    ["missing scope", {}],
    ["non-object scope", { permissions: "project:create" }],
    ["non-array resource scope", { permissions: { project: "create" } }],
    [
      "mixed malformed scope",
      { permissions: { project: ["create"], task: null } },
    ],
  ])("fails closed for %s", (_label, apiKey) => {
    expect(apiKeyScopeSatisfies(apiKey as never, required)).toBe(false);
  });

  it("uses the canonical capability's exact resource/action pair", () => {
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { instance: ["read_audit"] } },
        "instance:read_audit",
      ),
    ).toBe(true);
    expect(
      apiKeyHasCapabilityScope(
        { permissions: { instance: ["admin"] } },
        "instance:read_audit",
      ),
    ).toBe(false);
    expect(apiKeyHasCapabilityScope(undefined, "instance:read_audit")).toBe(
      true,
    );
  });

  it("projects only recognized stored statements into the canonical key subset", () => {
    expect(
      apiKeyCapabilitySubset({
        permissions: {
          work_item: ["update", "invented"],
          project: ["read"],
          legacy_resource: ["read"],
        },
      }),
    ).toEqual(["work_item:update", "project:read"]);
    expect(apiKeyCapabilitySubset({ permissions: null })).toEqual([]);
    expect(
      apiKeyCapabilitySubset({
        permissions: { work_item: ["update"], malformed: null as never },
      }),
    ).toEqual([]);
  });
});
