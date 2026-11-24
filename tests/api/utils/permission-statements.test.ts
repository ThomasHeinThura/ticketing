import { describe, expect, it } from "vitest";
import {
  parsePermissionStatements,
  satisfies,
} from "../../../apps/api/src/utils/permission-statements";

describe("permission statements", () => {
  it("rejects invalid roots and filters malformed actions", () => {
    expect(parsePermissionStatements("{")).toBeNull();
    expect(parsePermissionStatements("[]")).toBeNull();
    expect(
      parsePermissionStatements('{"task":["read",1],"other":true}'),
    ).toEqual({ task: ["read"] });
    expect(parsePermissionStatements("{}")).toEqual({});
  });

  it("requires every requested action", () => {
    expect(satisfies({ task: ["read"] }, { task: ["read"] })).toBe(true);
    expect(satisfies({ task: ["read"] }, { task: ["write"] })).toBe(false);
    expect(satisfies({}, { task: [] })).toBe(false);
    expect(satisfies({}, {})).toBe(true);
  });
});
