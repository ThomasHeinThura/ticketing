import { describe, expect, it } from "vitest";
import {
  parseDashboardSearch,
  parseReportBuilderSearch,
  parseReportSearch,
  parseReportsIndexSearch,
  reportQuery,
} from "./report-search";

describe("report search (RP-8)", () => {
  it("never writes a default", () => {
    expect(parseReportSearch({ window: "30", view: "chart" })).toEqual({});
    expect(parseReportSearch({})).toEqual({});
    expect(parseReportSearch(undefined)).toEqual({});
  });

  it("keeps the whole filter state", () => {
    const search = parseReportSearch({
      window: "90",
      projectId: "p1",
      organisationId: "o1",
      teamId: "t1",
      typeId: "ty1",
      priority: "urgent",
      by: "priority",
      metric: "first_response",
      days: "30",
      cycle: "c1",
      view: "table",
      drill: "high",
    });
    expect(search).toEqual({
      window: "90",
      projectId: "p1",
      organisationId: "o1",
      teamId: "t1",
      typeId: "ty1",
      priority: "urgent",
      by: "priority",
      metric: "first_response",
      days: "30",
      cycle: "c1",
      view: "table",
      drill: "high",
    });
    expect(parseReportSearch(search)).toEqual(search);
  });

  it("takes a custom window only with valid calendar days", () => {
    expect(
      parseReportSearch({
        window: "custom",
        from: "2026-10-01",
        to: "2026-10-07",
      }),
    ).toEqual({ window: "custom", from: "2026-10-01", to: "2026-10-07" });
    expect(
      parseReportSearch({ window: "custom", from: "2026-02-30", to: "x" }),
    ).toEqual({ window: "custom" });
    // from/to mean nothing without the custom window
    expect(parseReportSearch({ window: "7", from: "2026-10-01" })).toEqual({
      window: "7",
    });
  });

  it("drops what it does not know", () => {
    expect(
      parseReportSearch({
        window: "14",
        priority: "critical",
        metric: "x",
        days: "3",
        view: "pie",
        projectId: "",
        by: "a".repeat(201),
        cycle: "bad\u0000",
      }),
    ).toEqual({});
  });

  it("builds the same query for the URL and, without screen state, for the API", () => {
    const search = parseReportSearch({
      window: "7",
      priority: "high",
      view: "table",
      drill: "x",
    });
    expect(reportQuery(search).toString()).toBe(
      "window=7&drill=x&priority=high&view=table",
    );
    expect(reportQuery(search, true).toString()).toBe("window=7&priority=high");
  });

  it("parses the index, builder and dashboard searches", () => {
    expect(parseReportsIndexSearch({ category: "people" })).toEqual({
      category: "people",
    });
    expect(parseReportsIndexSearch({ category: "other" })).toEqual({});
    expect(parseReportBuilderSearch({ view: "v1" })).toEqual({ view: "v1" });
    expect(parseReportBuilderSearch(null)).toEqual({});
    expect(parseDashboardSearch({ id: "d1" })).toEqual({ id: "d1" });
    expect(parseDashboardSearch({ id: 5 })).toEqual({});
  });
});
