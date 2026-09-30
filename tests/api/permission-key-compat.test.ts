import { describe, expect, it } from "vitest";
import {
  mirrorWorkItemPermissionForLegacyReplicas,
  normalizeWorkItemPermissionKey,
} from "../../apps/api/src/utils/permission-key-compat";

describe("work-item permission-key rollout compatibility", () => {
  it("normalizes a task-only row written by an old replica", () => {
    expect(
      normalizeWorkItemPermissionKey({ task: ["read", "create"] }),
    ).toEqual({
      work_item: ["read", "create"],
    });
  });

  it("keeps the canonical key authoritative when both keys differ", () => {
    expect(
      normalizeWorkItemPermissionKey({
        task: ["read", "create"],
        work_item: ["read"],
      }),
    ).toEqual({ work_item: ["read"] });
  });

  it("preserves an explicit empty canonical grant set", () => {
    expect(
      normalizeWorkItemPermissionKey({ task: ["create"], work_item: [] }),
    ).toEqual({ work_item: [] });
  });

  it("mirrors new grants and revocations for older replicas", () => {
    expect(
      mirrorWorkItemPermissionForLegacyReplicas({ work_item: ["read"] }),
    ).toEqual({ work_item: ["read"], task: ["read"] });
  });

  it("does not mutate the caller's permission map", () => {
    const input = { task: ["read"] };
    normalizeWorkItemPermissionKey(input);
    expect(input).toEqual({ task: ["read"] });
  });
});
