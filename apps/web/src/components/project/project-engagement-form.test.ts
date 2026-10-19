import { describe, expect, it } from "vitest";
import {
  buildEngagementPayload,
  classifyEngagementFailure,
  hasEngagementErrors,
  isEngagementDirty,
  toEngagementValues,
  validateEngagement,
} from "./project-engagement-form";

describe("toEngagementValues", () => {
  it("narrows a project payload", () => {
    expect(
      toEngagementValues({
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: "cal-1",
      }),
    ).toEqual({
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: "cal-1",
    });
  });

  it("treats unknown or empty values as unset instead of trusting them", () => {
    expect(
      toEngagementValues({
        kind: "retainer",
        supportLevel: "L9",
        serviceCalendarId: "",
      }),
    ).toEqual({ kind: "project", supportLevel: null, serviceCalendarId: null });
    expect(toEngagementValues({})).toEqual({
      kind: "project",
      supportLevel: null,
      serviceCalendarId: null,
    });
  });
});

describe("validateEngagement (PR-9, mirrors the server)", () => {
  it("never complains about a plain project, even with nothing set", () => {
    expect(
      validateEngagement({
        kind: "project",
        supportLevel: null,
        serviceCalendarId: null,
      }),
    ).toEqual({});
  });

  it("requires both support level and calendar for a managed service", () => {
    const errors = validateEngagement({
      kind: "managed_service",
      supportLevel: null,
      serviceCalendarId: null,
    });
    expect(errors).toEqual({
      supportLevel: "required",
      serviceCalendarId: "required",
    });
    expect(hasEngagementErrors(errors)).toBe(true);
  });

  it("names only the missing field", () => {
    expect(
      validateEngagement({
        kind: "managed_service",
        supportLevel: "L1",
        serviceCalendarId: null,
      }),
    ).toEqual({ serviceCalendarId: "required" });
    expect(
      validateEngagement({
        kind: "managed_service",
        supportLevel: null,
        serviceCalendarId: "cal-1",
      }),
    ).toEqual({ supportLevel: "required" });
  });

  it("accepts a complete managed service", () => {
    expect(
      hasEngagementErrors(
        validateEngagement({
          kind: "managed_service",
          supportLevel: "L3",
          serviceCalendarId: "cal-1",
        }),
      ),
    ).toBe(false);
  });
});

describe("isEngagementDirty and buildEngagementPayload", () => {
  const base = {
    kind: "project" as const,
    supportLevel: null,
    serviceCalendarId: null,
  };

  it("detects a change in any one field", () => {
    expect(isEngagementDirty(base, { ...base })).toBe(false);
    expect(isEngagementDirty(base, { ...base, kind: "managed_service" })).toBe(
      true,
    );
    expect(isEngagementDirty(base, { ...base, supportLevel: "L1" })).toBe(true);
    expect(isEngagementDirty(base, { ...base, serviceCalendarId: "c" })).toBe(
      true,
    );
  });

  it("sends a cleared field as an explicit null, never undefined", () => {
    const payload = buildEngagementPayload(base);
    expect(payload).toStrictEqual({
      kind: "project",
      supportLevel: null,
      serviceCalendarId: null,
    });
  });
});

describe("classifyEngagementFailure", () => {
  it("maps statuses to reasons without echoing server text", () => {
    expect(classifyEngagementFailure(403, "Insufficient permissions")).toBe(
      "forbidden",
    );
    expect(classifyEngagementFailure(404, "x")).toBe("notFound");
    expect(
      classifyEngagementFailure(
        422,
        "PR-9: managed services require a support level and service calendar",
      ),
    ).toBe("managedServiceIncomplete");
    expect(
      classifyEngagementFailure(
        422,
        "service_calendar_must_belong_to_workspace",
      ),
    ).toBe("calendarInvalid");
    expect(classifyEngagementFailure(500, "boom")).toBe("generic");
    expect(classifyEngagementFailure(undefined, undefined)).toBe("generic");
  });
});
