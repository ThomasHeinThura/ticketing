import { describe, expect, it } from "vitest";
import { parseTimesheetSearch, routes } from "./routes";

describe("timesheet URL state", () => {
  it("normalises any date in a week to its Monday", () => {
    expect(parseTimesheetSearch({ week: "2026-10-24" })).toEqual({
      week: "2026-10-19",
    });
    expect(parseTimesheetSearch({ week: "2026-10-19" })).toEqual({
      week: "2026-10-19",
    });
  });

  it("keeps the everyone scope and drops anything else", () => {
    expect(parseTimesheetSearch({ scope: "everyone" })).toEqual({
      scope: "everyone",
    });
    expect(parseTimesheetSearch({ scope: "me" })).toEqual({});
    expect(parseTimesheetSearch({ week: "2026-02-30", scope: 3 })).toEqual({});
    expect(parseTimesheetSearch(null)).toEqual({});
  });

  it("builds the same URL it parses, and writes nothing for the current week", () => {
    expect(routes.timesheet.build()).toBe("/agent/timesheet");
    const built = routes.timesheet.build({
      week: "2026-10-21",
      scope: "everyone",
    });
    expect(built).toBe("/agent/timesheet?week=2026-10-19&scope=everyone");
    const params = new URL(built, "https://taskdesk.example").searchParams;
    expect(
      parseTimesheetSearch({
        week: params.get("week"),
        scope: params.get("scope"),
      }),
    ).toEqual({ week: "2026-10-19", scope: "everyone" });
  });

  it("keeps the settings and budget routes at their documented paths", () => {
    expect(routes.workspaceRates.path).toBe("/agent/settings/rates");
    expect(routes.workspaceTimeActivities.path).toBe(
      "/agent/settings/time-activities",
    );
    expect(routes.projectBudget.build({ projectKey: "HELP" })).toBe(
      "/agent/projects/HELP/settings/budget",
    );
  });
});
