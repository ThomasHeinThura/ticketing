import { describe, expect, it } from "vitest";
import { reportBuilderGroupsForEntity } from "./report-builder";

describe("tier 3 report builder groups", () => {
  it("offers epic grouping for work items only", () => {
    expect(reportBuilderGroupsForEntity("work_item")).toContain("epic");
    expect(reportBuilderGroupsForEntity("time_entry")).not.toContain("epic");
  });
});
