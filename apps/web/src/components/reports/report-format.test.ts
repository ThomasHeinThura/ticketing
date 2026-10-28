import { describe, expect, it } from "vitest";
import type { ReportColumn, ReportMetric } from "@/fetchers/report";
import {
  cellText,
  columnLabel,
  formatMoney,
  formatValue,
  isInsufficient,
  metricText,
} from "./report-format";

const t = ((key: string, options?: Record<string, unknown>) =>
  options && "n" in options
    ? `${key}:${options.n}/${options.needed}`
    : key) as never;

const column = (kind: ReportColumn["kind"]): ReportColumn => ({
  key: "k",
  label: "K",
  kind,
});

describe("report formatting", () => {
  it("shows insufficient data as its reason, never a number (RP-1)", () => {
    const metric: ReportMetric = {
      key: "a",
      label: "A",
      unit: "percent",
      value: null,
      n: 3,
      needed: 10,
    };
    expect(metricText(metric, t)).toBe("reports:notEnoughData:3/10");
    expect(metricText({ ...metric, value: 0, n: 12 }, t)).toBe("0%");
    expect(cellText({ n: 2, needed: 10 }, column("percent"), {}, t)).toBe(
      "reports:notEnoughData:2/10",
    );
    expect(isInsufficient({ n: 1, needed: 2 })).toBe(true);
    expect(isInsufficient(5)).toBe(false);
    expect(isInsufficient(null)).toBe(false);
  });

  it("writes not-applicable as a dash", () => {
    expect(cellText(null, column("text"), {}, t)).toBe("—");
    expect(cellText("", column("text"), {}, t)).toBe("—");
    expect(cellText(undefined, column("number"), {}, t)).toBe("—");
  });

  it("localizes the inactive-assignee status without changing unrelated text cells", () => {
    expect(
      cellText(
        "Inactive",
        { key: "inactive", label: "Status", kind: "text" },
        {},
        t,
      ),
    ).toBe("reports:values.inactive");
    expect(
      cellText("Inactive", { key: "note", label: "Note", kind: "text" }, {}, t),
    ).toBe("Inactive");
  });

  it("localizes epic special buckets from their typed drill handles only", () => {
    const groupColumn: ReportColumn = {
      key: "group",
      label: "Group",
      kind: "text",
    };
    expect(cellText("No epic", groupColumn, { _drill: "epic-none" }, t)).toBe(
      "reports:groups.noEpic",
    );
    expect(
      cellText(
        "Epic unavailable",
        groupColumn,
        { _drill: "epic-unavailable" },
        t,
      ),
    ).toBe("reports:groups.epicUnavailable");
    expect(
      cellText("epic-none", groupColumn, { _drill: "project:epic-none" }, t),
    ).toBe("epic-none");
  });

  it("uses the matching-work-items heading only for the epic count column", () => {
    expect(
      columnLabel(
        { key: "value", label: "Matching work items", kind: "number" },
        t,
      ),
    ).toBe("reports:columns.matchingWorkItems");
    expect(columnLabel(column("number"), t)).toBe("reports:columns.k");
  });

  it("formats numbers by column kind", () => {
    expect(cellText(87.5, column("percent"), {}, t)).toBe("87.5%");
    expect(cellText(3.5, column("hours"), {}, t)).toBe("3.5 h");
    expect(formatValue(0.25, "hours")).toBe("0.25 h");
    expect(formatValue(0.5, "hours")).toBe("0.5 h");
    expect(formatValue(1 / 60, "hours")).toBe("0.02 h");
    expect(cellText(12, column("days"), {}, t)).toBe("12 d");
    expect(cellText(4, column("number"), {}, t)).toBe("4");
    expect(formatValue(2.25, "count")).toBe("2.3");
  });

  it("reads money in its own row currency, in minor units, never summed", () => {
    expect(formatMoney(9000, "EUR", "en-US")).toBe("€90.00");
    expect(formatMoney(500, "JPY", "en-US")).toBe("¥500");
    expect(cellText(9000, column("money"), { currency: "USD" }, t)).toBe(
      "$90.00",
    );
    expect(cellText(9000, column("money"), {}, t)).toBe("9000");
    expect(formatMoney(100, "not-a-currency")).toBe("not-a-currency 100");
  });
});
