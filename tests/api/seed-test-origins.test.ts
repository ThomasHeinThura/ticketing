import { describe, expect, it } from "vitest";
import { configureSeedTestOrigins } from "../../apps/api/scripts/seed-test-origins";

describe("standalone seed-test auth origins", () => {
  it("uses the same safe origins as the API integration harness by default", () => {
    const environment: {
      TASKDESK_AGENT_URL?: string;
      TASKDESK_PORTAL_URL?: string;
    } = {};

    expect(configureSeedTestOrigins(environment)).toEqual({
      agent: "http://localhost:1337",
      portal: "http://portal.localhost:5174",
    });
    expect(environment).toEqual({
      TASKDESK_AGENT_URL: "http://localhost:1337",
      TASKDESK_PORTAL_URL: "http://portal.localhost:5174",
    });
  });

  it("preserves explicitly configured HTTP(S) origins and normalizes a trailing slash", () => {
    const environment = {
      TASKDESK_AGENT_URL: "https://agent.test/",
      TASKDESK_PORTAL_URL: "https://portal.test",
    };

    expect(configureSeedTestOrigins(environment)).toEqual({
      agent: "https://agent.test",
      portal: "https://portal.test",
    });
    expect(environment.TASKDESK_AGENT_URL).toBe("https://agent.test");
  });

  it("rejects non-origin values without partially changing the environment", () => {
    const environment = {
      TASKDESK_AGENT_URL: "https://agent.test/",
      TASKDESK_PORTAL_URL: "not an origin",
    };

    expect(() => configureSeedTestOrigins(environment)).toThrow(
      "TASKDESK_PORTAL_URL must be an absolute HTTP(S) origin",
    );
    expect(environment).toEqual({
      TASKDESK_AGENT_URL: "https://agent.test/",
      TASKDESK_PORTAL_URL: "not an origin",
    });
  });
});
