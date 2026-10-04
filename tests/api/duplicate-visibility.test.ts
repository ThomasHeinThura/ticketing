import { describe, expect, it } from "vitest";
import { mayExposeDuplicateSuggestions } from "../../apps/api/src/request-type/duplicate-visibility";

describe("IQ-18 duplicate suggestion visibility", () => {
  it("requires a staff user with work-item read and no API-key context", () => {
    expect(
      mayExposeDuplicateSuggestions({
        hasUser: true,
        hasApiKey: false,
        hasWorkItemRead: true,
      }),
    ).toBe(true);
    expect(
      mayExposeDuplicateSuggestions({
        hasUser: true,
        hasApiKey: false,
        hasWorkItemRead: false,
      }),
    ).toBe(false);
    expect(
      mayExposeDuplicateSuggestions({
        hasUser: true,
        hasApiKey: true,
        hasWorkItemRead: true,
      }),
    ).toBe(false);
    expect(
      mayExposeDuplicateSuggestions({
        hasUser: false,
        hasApiKey: false,
        hasWorkItemRead: true,
      }),
    ).toBe(false);
  });
});
