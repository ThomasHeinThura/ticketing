import { describe, expect, it } from "vitest";
import {
  decodeHierarchyPageCursor,
  encodeHierarchyPageCursor,
} from "../../apps/api/src/work-item/hierarchy-page-cursor";
import { hierarchyChildrenQuery } from "../../apps/api/src/work-item/schema";

const scope = {
  workspaceId: "ws-a",
  projectId: "project-a",
  parentId: "parent-a",
  limit: 50,
};
const after = { position: "9999999999.1234567890", id: "child-a" };
const raw = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
describe("hierarchy continuation isolation", () => {
  it("retains exact numeric(20,10) decimal precision", () => {
    const decoded = decodeHierarchyPageCursor(
      encodeHierarchyPageCursor(scope, after),
      scope,
    );
    expect(decoded.position).toBe(after.position);
    expect(decoded.id).toBe(after.id);
    expect(decoded.position).not.toBe(String(Number(after.position)));
  });
  it("serializes only continuation coordinates from a materialized child row", () => {
    const row = {
      ...after,
      title: "Private child title",
      stateName: "Backlog",
      hasChildren: true,
    };
    const cursor = encodeHierarchyPageCursor(scope, row);
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toContain(
      row.title,
    );
    expect(decodeHierarchyPageCursor(cursor, scope).id).toBe(after.id);
  });
  it.each(["workspaceId", "projectId", "parentId", "limit"] as const)(
    "rejects reuse in another %s",
    (field) => {
      const different = {
        ...scope,
        [field]: field === "limit" ? 51 : "different",
      };
      expect(() =>
        decodeHierarchyPageCursor(
          encodeHierarchyPageCursor(scope, after),
          different,
        ),
      ).toThrow("cursor:");
    },
  );
  it.each([
    "Infinity",
    "NaN",
    "1e4",
    "10000000000",
    "0.12345678901",
    "1; DROP TABLE work_item",
    "\u0000",
  ])("rejects invalid database position %j", (position) => {
    expect(() =>
      decodeHierarchyPageCursor(
        raw({ v: 1, ...scope, ...after, position }),
        scope,
      ),
    ).toThrow("cursor:");
  });
  it.each(["-9999999999.9999999999", "0", "0.0000000001"])(
    "accepts valid exact boundary %s",
    (position) => {
      expect(
        decodeHierarchyPageCursor(
          encodeHierarchyPageCursor(scope, { ...after, position }),
          scope,
        ).position,
      ).toBe(position);
    },
  );
  it("rejects extra fields, unknown versions, oversized ids and noncanonical encoding", () => {
    for (const value of [
      raw({ v: 2, ...scope, ...after }),
      raw({ v: 1, ...scope, ...after, authority: "admin" }),
      raw({ v: 1, ...scope, ...after, id: "x".repeat(129) }),
      raw({ v: 1, ...scope, ...after, id: "\u0000" }),
      "x".repeat(2049),
      `${encodeHierarchyPageCursor(scope, after)}=`,
      "not-json",
    ])
      expect(() => decodeHierarchyPageCursor(value, scope)).toThrow("cursor:");
  });
  it("validates bounded page sizes before the repository", () => {
    expect(hierarchyChildrenQuery.parse({}).limit).toBe(50);
    expect(hierarchyChildrenQuery.parse({ limit: "200" }).limit).toBe(200);
    for (const limit of ["0", "201", "1.5", "NaN", "Infinity"])
      expect(hierarchyChildrenQuery.safeParse({ limit }).success).toBe(false);
  });
});
