import { describe, expect, it } from "vitest";
import {
  parseConfiguredOrigins,
  publicOriginForKind,
  selectOriginFromContext,
  selectOriginFromHost,
} from "../../apps/api/src/utils/request-origin";

const origins = parseConfiguredOrigins(
  "https://agent.example.test",
  "https://portal.example.test",
);

describe("Host-selected app origins", () => {
  it("maps validated agent and portal surfaces to their configured origins", () => {
    expect(publicOriginForKind("agent", origins)).toBe(
      "https://agent.example.test",
    );
    expect(publicOriginForKind("portal", origins)).toBe(
      "https://portal.example.test",
    );
    expect(publicOriginForKind("agent", origins)).not.toContain("/api");
  });

  it("does not select a public origin from forwarded headers or a spoofed Host", () => {
    const context = {
      req: {
        header: (name: string) =>
          ({
            host: "attacker.example",
            "x-forwarded-host": "agent.example.test",
            "x-forwarded-proto": "https",
          })[name.toLowerCase()],
      },
    } as never;
    expect(selectOriginFromContext(context, origins)).toBe("unknown");
  });

  it("normalizes DNS case, IDNA, and default ports under each public scheme", () => {
    expect(selectOriginFromHost("AGENT.EXAMPLE.TEST.:443", origins)).toBe(
      "agent",
    );
    expect(selectOriginFromHost("portal.example.test", origins)).toBe("portal");
    const idna = parseConfiguredOrigins(
      "https://bücher.example",
      "https://portal.example",
    );
    expect(selectOriginFromHost("xn--bcher-kva.example:443", idna)).toBe(
      "agent",
    );
  });

  it("requires distinct hostnames and rejects non-origin configuration", () => {
    expect(() =>
      parseConfiguredOrigins(
        "https://same.example",
        "https://same.example:8443",
      ),
    ).toThrow(/distinct hostnames/u);
    expect(() =>
      parseConfiguredOrigins(
        "https://agent.example/path",
        "https://portal.example",
      ),
    ).toThrow(/only an HTTP origin/u);
    expect(() =>
      parseConfiguredOrigins("https://agent.example", undefined),
    ).toThrow(/required/u);
  });

  it("rejects malformed authorities and labels unknown hosts without selecting a fallback", () => {
    for (const value of [
      "",
      "agent.example/path",
      "agent.example,portal.example",
      "user@agent.example",
      "agent.example:65536",
    ])
      expect(selectOriginFromHost(value, origins)).toBe("invalid");
    expect(selectOriginFromHost("other.example", origins)).toBe("unknown");
  });

  it("uses the Node raw header list and refuses duplicate Host fields", () => {
    const context = {
      env: {
        incoming: {
          httpVersionMajor: 1,
          rawHeaders: [
            "Host",
            "agent.example.test",
            "host",
            "portal.example.test",
          ],
        },
      },
      req: { header: () => "agent.example.test" },
    } as never;
    expect(selectOriginFromContext(context, origins)).toBe("invalid");
  });

  it("requires one matching HTTP/2 authority and rejects a conflicting Host", () => {
    const binding = (host: string) => ({
      httpVersionMajor: 2,
      authority: "agent.example.test",
      rawHeaders: ["host", host],
    });
    const matching = {
      env: { incoming: binding("AGENT.EXAMPLE.TEST:443") },
      req: { header: () => "agent.example.test" },
    } as never;
    const conflicting = {
      env: { incoming: binding("portal.example.test") },
      req: { header: () => "agent.example.test" },
    } as never;
    expect(selectOriginFromContext(matching, origins)).toBe("agent");
    expect(selectOriginFromContext(conflicting, origins)).toBe("invalid");
  });
});
