import { describe, expect, it } from "vitest";
import { intersectProjectScope } from "../../apps/api/src/work-item/search/repository";

describe("server-derived search project scope", () => {
  it("leaves ordinary search's readable project set unchanged when omitted", () => {
    const readable = ["project-a", "project-b"];
    expect(intersectProjectScope(readable)).toEqual(readable);
  });

  it("intersects the readable set with the trusted scope without widening it", () => {
    expect(
      intersectProjectScope(
        ["project-a", "project-b"],
        ["project-b", "foreign", "project-c"],
      ),
    ).toEqual(["project-b"]);
  });

  it("treats an explicitly empty trusted scope as no projects", () => {
    expect(intersectProjectScope(["project-a", "project-b"], [])).toEqual([]);
  });
});
