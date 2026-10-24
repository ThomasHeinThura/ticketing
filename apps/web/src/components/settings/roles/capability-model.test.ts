import { describe, expect, it } from "vitest";
import {
  callerRank,
  capabilityClosure,
  capabilityLabel,
  compareCapabilities,
  diffSelections,
  heldCapabilities,
  ROLE_CAPABILITY_ITEMS,
  requiredByMap,
  summariseCapabilities,
} from "./capability-model";

describe("role capability model", () => {
  it("lists every workspace-tier capability once, grouped, never an instance one (RL-1, RL-6)", () => {
    const ids = ROLE_CAPABILITY_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("instance:"))).toBe(false);
    expect(
      ROLE_CAPABILITY_ITEMS.every((item) => item.description.length > 0),
    ).toBe(true);
    // Items of one group are contiguous, so the matrix renders each group once.
    const seen: string[] = [];
    for (const item of ROLE_CAPABILITY_ITEMS) {
      if (seen.at(-1) !== item.group) seen.push(item.group);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("labels a capability as resource and action", () => {
    expect(capabilityLabel("work_item:update_any")).toBe(
      "Work item: update any",
    );
  });

  it("expands implications into the closure (RL-5)", () => {
    expect(capabilityClosure(["work_item:update"])).toEqual([
      "work_item:read",
      "work_item:update",
    ]);
  });

  it("names which ticked capability still requires an implied one", () => {
    expect(requiredByMap(["work_item:update", "work_item:read"])).toEqual({
      "work_item:read": ["work_item:update"],
    });
    expect(requiredByMap(["work_item:read"])).toEqual({});
  });

  it("diffs a draft against its baseline", () => {
    expect(diffSelections(["a:x", "b:y"], ["b:y", "c:z"])).toEqual({
      added: ["c:z"],
      removed: ["a:x"],
    });
  });

  it("derives what the caller holds and their rank from their own role", () => {
    const roles = [
      { role: "ops", rank: 30, capabilities: ["work_item:update"] },
    ];
    expect([...heldCapabilities("ops", roles)].sort()).toEqual([
      "work_item:read",
      "work_item:update",
    ]);
    expect(callerRank("ops", roles)).toBe(30);
    expect(heldCapabilities("owner", roles).has("workspace:delete")).toBe(true);
    expect(callerRank("owner", roles)).toBe(100);
    expect(heldCapabilities("ghost", roles).size).toBe(0);
    expect(callerRank(undefined, roles)).toBe(0);
  });

  it("summarises a set in plain sentences by area (RL-11)", () => {
    const summary = summariseCapabilities(["work_item:update"]);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.group).toBe("Work items");
    expect(summary[0]?.items.map((item) => item.id)).toEqual([
      "work_item:read",
      "work_item:update",
    ]);
  });

  it("never leaks markdown into summaries or compare rows", () => {
    const text = [
      ...summariseCapabilities(["approval:decide_cab"]).flatMap((g) =>
        g.items.map((i) => i.description),
      ),
      ...compareCapabilities(["approval:decide_cab"], []).map(
        (r) => r.description,
      ),
      ...ROLE_CAPABILITY_ITEMS.map((i) => i.description),
    ].join("\n");
    expect(text).not.toMatch(/\*\*|\]\(|`/);
  });

  it("compares two roles showing only where they differ (RL-13)", () => {
    const rows = compareCapabilities(
      ["work_item:update"],
      ["work_item:read", "label:manage"],
    );
    expect(rows.map((row) => [row.id, row.inLeft, row.inRight])).toEqual([
      ["work_item:update", true, false],
      ["label:manage", false, true],
    ]);
    expect(compareCapabilities(["work_item:read"], ["work_item:read"])).toEqual(
      [],
    );
  });
});
