import { describe, expect, it } from "vitest";
import {
  CATALOGUE_KEY_PATTERN,
  deriveCatalogueKey,
} from "../../apps/api/src/label/catalogue-key";
import {
  createLabelBody,
  updateLabelBody,
} from "../../apps/api/src/label/schema";
import {
  createCalendarBody,
  updateCalendarBody,
} from "../../apps/api/src/service-calendar/schema";
import {
  createPolicyBody,
  updatePolicyBody,
} from "../../apps/api/src/sla-policy/schema";

describe("stable workspace catalogue keys", () => {
  it("derives migration-compatible slug keys and rejects names with no ASCII key", () => {
    expect(deriveCatalogueKey("  Café / Customer Support  ")).toBe(
      "cafe-customer-support",
    );
    expect(deriveCatalogueKey("A_ B")).toBe("a-b");
    expect(deriveCatalogueKey("漢字")).toBeNull();
    expect(deriveCatalogueKey(`a${"b".repeat(80)}`)).toHaveLength(64);
  });

  it("uses the registered key format and allows compatibility creates to omit keys", () => {
    expect(CATALOGUE_KEY_PATTERN.test("team-01_alpha")).toBe(true);
    expect(CATALOGUE_KEY_PATTERN.test("Uppercase")).toBe(false);
    expect(CATALOGUE_KEY_PATTERN.test("-leading-hyphen")).toBe(false);
    expect(CATALOGUE_KEY_PATTERN.test("x".repeat(65))).toBe(false);

    expect(
      createLabelBody.safeParse({
        name: "Urgent",
        color: "#ff0000",
        workspaceId: "ws-1",
      }).success,
    ).toBe(true);
    expect(
      createPolicyBody.safeParse({
        name: "Default SLA",
        calendarId: "cal-1",
      }).success,
    ).toBe(true);
    expect(
      createCalendarBody.safeParse({
        workspaceId: "ws-1",
        name: "Weekdays",
        timezone: "UTC",
        windows: {},
        holidays: [],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed keys and keys on non-workspace labels", () => {
    expect(
      createLabelBody.safeParse({
        name: "Urgent",
        color: "#ff0000",
        workspaceId: "ws-1",
        key: "Bad Key",
      }).success,
    ).toBe(false);
    expect(
      createLabelBody.safeParse({
        name: "Urgent",
        color: "#ff0000",
        workspaceId: "ws-1",
        taskId: "task-1",
        key: "urgent",
      }).success,
    ).toBe(false);
    expect(
      createPolicyBody.safeParse({
        name: "Default SLA",
        calendarId: "cal-1",
        key: "Uppercase",
      }).success,
    ).toBe(false);
    expect(
      createCalendarBody.safeParse({
        workspaceId: "ws-1",
        name: "Weekdays",
        key: "Uppercase",
        timezone: "UTC",
        windows: {},
        holidays: [],
      }).success,
    ).toBe(false);
  });

  it("rejects attempted key changes at each strict update boundary", () => {
    expect(
      updateLabelBody.safeParse({
        name: "Changed",
        color: "#000000",
        key: "new-key",
      }).success,
    ).toBe(false);
    expect(updatePolicyBody.safeParse({ key: "new-key" }).success).toBe(false);
    expect(updateCalendarBody.safeParse({ key: "new-key" }).success).toBe(
      false,
    );
  });
});
