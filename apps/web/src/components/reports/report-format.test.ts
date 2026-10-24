import { describe, expect, it } from "vitest";
import type { ReportColumn, ReportMetric } from "@/fetchers/report";
import {
  cellText,
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

  it("formats numbers by column kind", () => {
    expect(cellText(87.5, column("percent"), {}, t)).toBe("87.5%");
    expect(cellText(3.5, column("hours"), {}, t)).toBe("3.5 h");
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
