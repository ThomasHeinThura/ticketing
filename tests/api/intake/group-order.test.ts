import { describe, expect, it } from "vitest";
import { orderPortalCatalogueGroups } from "../../../apps/api/src/intake/group-order";

describe("portal request type group ordering", () => {
  it("applies the lexically earliest contributing workspace's local order", () => {
    expect(
      orderPortalCatalogueGroups([
        { workspaceId: "workspace-b", groups: ["Shared", "B only"] },
        { workspaceId: "workspace-a", groups: ["A first", "Shared", "A last"] },
      ]),
    ).toEqual(["A first", "Shared", "A last", "B only"]);
  });

  it("merges duplicate group labels and resolves same-workspace ties by label", () => {
    expect(
      orderPortalCatalogueGroups([
        { workspaceId: "workspace-z", groups: ["Zulu"] },
        { workspaceId: "workspace-a", groups: ["Beta", "Alpha", "Beta"] },
      ]),
    ).toEqual(["Beta", "Alpha", "Zulu"]);
  });

  it("returns an empty order when no catalogue groups are assigned", () => {
    expect(orderPortalCatalogueGroups([])).toEqual([]);
  });
});
