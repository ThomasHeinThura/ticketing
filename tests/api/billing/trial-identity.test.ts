import { describe, expect, it } from "vitest";
import {
  hashTrialEmail,
  normalizeTrialEmail,
} from "../../../apps/api/src/billing/trial-identity";

describe("normalizeTrialEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeTrialEmail("  Andrej@TaskDesk.APP ")).toBe(
      "andrej@taskdesk.app",
    );
  });

  it("drops plus tags so aliases share one trial", () => {
    expect(normalizeTrialEmail("andrej+trial2@taskdesk.app")).toBe(
      "andrej@taskdesk.app",
    );
  });

  it("keeps the address when stripping would empty the local part", () => {
    expect(normalizeTrialEmail("+tag@taskdesk.app")).toBe("+tag@taskdesk.app");
  });

  it("leaves values without an address shape alone", () => {
    expect(normalizeTrialEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("hashTrialEmail", () => {
  it("matches for addresses that normalize to the same mailbox", () => {
    expect(hashTrialEmail("Andrej+one@taskdesk.app")).toBe(
      hashTrialEmail("andrej@taskdesk.app"),
    );
  });

  it("differs for different mailboxes", () => {
    expect(hashTrialEmail("a@taskdesk.app")).not.toBe(
      hashTrialEmail("b@taskdesk.app"),
    );
  });

  it("does not store the address itself", () => {
    expect(hashTrialEmail("andrej@taskdesk.app")).not.toContain("taskdesk");
  });
});
