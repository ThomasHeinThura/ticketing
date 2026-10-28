import { describe, expect, it } from "vitest";
import {
  checkMoveSize,
  collectSubtree,
  exposesAcrossOrganisations,
  MAX_MOVE_SUBTREE,
  movedKey,
  planLabelMove,
  planPositionOrdinals,
  planStateMapping,
} from "../../../apps/api/src/work-item/move-plan";

const state = (
  id: string,
  stateTemplateId: string,
  position = 0,
  archived = false,
) => ({
  id,
  stateTemplateId,
  position,
  archivedAt: archived ? new Date(0) : null,
});

describe("planStateMapping", () => {
  const source = [state("s-todo", "t-todo"), state("s-done", "t-done")];

  it("maps each source state to the target's live state of the same template", () => {
    const result = planStateMapping(["s-todo", "s-done", "s-todo"], source, [
      state("x-done", "t-done"),
      state("x-todo", "t-todo"),
    ]);
    expect(result).toEqual({
      ok: true,
      map: new Map([
        ["s-todo", "x-todo"],
        ["s-done", "x-done"],
      ]),
    });
  });

  it("refuses when the target lacks a template instead of resetting the state", () => {
    expect(
      planStateMapping(["s-todo", "s-done"], source, [state("x", "t-todo")]),
    ).toEqual({ ok: false, unmappedStateIds: ["s-done"] });
  });

  it("never picks an archived target state", () => {
    expect(
      planStateMapping(["s-todo"], source, [state("x-old", "t-todo", 0, true)]),
    ).toEqual({ ok: false, unmappedStateIds: ["s-todo"] });
  });

  it("is deterministic when the target has several states of one template", () => {
    const result = planStateMapping(["s-todo"], source, [
      state("b", "t-todo", 2),
      state("c", "t-todo", 1),
      state("a", "t-todo", 1),
    ]);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.map.get("s-todo")).toBe("a");
  });

  it("treats an unknown source state as unmapped", () => {
    expect(planStateMapping(["ghost"], source, [state("x", "t")])).toEqual({
      ok: false,
      unmappedStateIds: ["ghost"],
    });
  });
});

describe("planLabelMove", () => {
  it("keeps workspace labels, remaps project labels by name and drops the rest", () => {
    const plan = planLabelMove(
      [
        { id: "ws", name: "Bug", projectId: null },
        { id: "p-feature", name: "Feature", projectId: "src" },
        { id: "p-only", name: "Only here", projectId: "src" },
      ],
      [{ id: "t-feature", name: "Feature" }],
    );
    expect(plan).toEqual({
      after: ["t-feature", "ws"],
      dropped: ["p-only"],
      remapped: [{ from: "p-feature", to: "t-feature" }],
    });
  });

  it("de-duplicates when two source labels map to one target label", () => {
    const plan = planLabelMove(
      [{ id: "p1", name: "X", projectId: "src" }],
      [{ id: "t1", name: "X" }],
    );
    expect(plan.after).toEqual(["t1"]);
  });

  it("is empty for an item with no labels", () => {
    expect(planLabelMove([], [])).toEqual({
      after: [],
      dropped: [],
      remapped: [],
    });
  });
});

describe("collectSubtree", () => {
  const rows = [
    { id: "root", parentId: null, number: 1 },
    { id: "c1", parentId: "root", number: 3 },
    { id: "c2", parentId: "root", number: 2 },
    { id: "g1", parentId: "c1", number: 5 },
    { id: "other", parentId: null, number: 4 },
  ];

  it("returns the root and every descendant in number order", () => {
    expect(collectSubtree(rows, "root")).toEqual(["root", "c2", "c1", "g1"]);
  });

  it("returns only the item for a leaf", () => {
    expect(collectSubtree(rows, "g1")).toEqual(["g1"]);
  });

  it("terminates on a corrupt cycle", () => {
    expect(
      collectSubtree(
        [
          { id: "a", parentId: "b", number: 1 },
          { id: "b", parentId: "a", number: 2 },
        ],
        "a",
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("move refusals and keys", () => {
  it("caps the subtree", () => {
    expect(checkMoveSize(MAX_MOVE_SUBTREE)).toBeNull();
    expect(checkMoveSize(MAX_MOVE_SUBTREE + 1)).toEqual({
      code: "too_large",
      size: MAX_MOVE_SUBTREE + 1,
    });
  });

  it("builds the key from the target slug and the claimed number", () => {
    expect(movedKey("OPS", 42)).toBe("OPS-42");
  });

  it("refuses organisation exposure only across different organisations", () => {
    const requested = [{ requesterId: "p", customerVisibility: "private" }];
    const visible = [{ requesterId: null, customerVisibility: "organisation" }];
    const internal = [{ requesterId: null, customerVisibility: "private" }];
    expect(exposesAcrossOrganisations("o1", "o2", requested)).toBe(true);
    expect(exposesAcrossOrganisations("o1", "o2", visible)).toBe(true);
    expect(exposesAcrossOrganisations(null, "o2", requested)).toBe(true);
    expect(exposesAcrossOrganisations("o1", "o2", internal)).toBe(false);
    expect(exposesAcrossOrganisations("o1", "o1", requested)).toBe(false);
    expect(exposesAcrossOrganisations(null, null, requested)).toBe(false);
  });
});

describe("planPositionOrdinals", () => {
  it("numbers rows 1..n per mapped state in the supplied order", () => {
    const ordinals = planPositionOrdinals([
      { id: "a", stateId: "s1" },
      { id: "b", stateId: "s2" },
      { id: "c", stateId: "s1" },
    ]);
    expect([...ordinals]).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 2],
    ]);
  });
});
