import { describe, expect, it } from "vitest";
import { lostWorkspaceCapabilities } from "../../../apps/api/src/api-key/authority-loss";

describe("lostWorkspaceCapabilities", () => {
  it("returns only capabilities removed from the canonical workspace authority", () => {
    expect(
      lostWorkspaceCapabilities(
        ["work_item:read", "work_item:update", "api_key:manage"],
        ["work_item:read"],
      ),
    ).toEqual(["work_item:update", "api_key:manage"]);
  });

  it("deduplicates the before snapshot and treats a null after snapshot as total loss", () => {
    expect(
      lostWorkspaceCapabilities(
        ["work_item:read", "work_item:read", "api_key:manage"],
        [],
      ),
    ).toEqual(["work_item:read", "api_key:manage"]);
  });

  it("does not report gains or unchanged authority as losses", () => {
    expect(
      lostWorkspaceCapabilities(
        ["work_item:read"],
        ["work_item:read", "work_item:update"],
      ),
    ).toEqual([]);
  });
});
