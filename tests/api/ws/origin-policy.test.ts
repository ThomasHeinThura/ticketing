import { describe, expect, it } from "vitest";
import { checkWebSocketOrigin } from "../../../apps/api/src/ws/origin-policy";

const agent = { host: "localhost:5173", origin: "http://localhost:5173" };
const portal = { host: "localhost:5174", origin: "http://localhost:5174" };

describe("WebSocket Origin and portal boundary", () => {
  it("accepts only a stored matching portal and its exact configured Origin", () => {
    expect(
      checkWebSocketOrigin({
        ...agent,
        sessionPortal: "agent",
        hasSession: true,
      }),
    ).toEqual({
      allowed: true,
      portal: "agent",
    });
    expect(
      checkWebSocketOrigin({
        ...portal,
        sessionPortal: "customer",
        hasSession: true,
      }),
    ).toEqual({
      allowed: true,
      portal: "customer",
    });
  });

  it.each([
    ["missing Origin", null],
    ["null Origin", "null"],
    ["foreign Origin", "https://attacker.example"],
    ["other portal Origin", portal.origin],
    ["comma-list Origin", `${agent.origin}, ${portal.origin}`],
    ["path-bearing Origin", `${agent.origin}/path`],
  ])("rejects session handshakes with %s", (_case, origin) => {
    expect(
      checkWebSocketOrigin({
        ...agent,
        origin,
        sessionPortal: "agent",
        hasSession: true,
      }),
    ).toEqual({
      allowed: false,
      status: 403,
    });
  });

  it.each([
    [
      "other portal session",
      { ...agent, origin: agent.origin, sessionPortal: "customer" },
    ],
    [
      "legacy unbound session",
      { ...agent, origin: agent.origin, sessionPortal: null },
    ],
    [
      "unknown host",
      {
        host: "internal-api:8080",
        origin: agent.origin,
        sessionPortal: "agent",
      },
    ],
    [
      "wrong port",
      { host: "localhost:1338", origin: agent.origin, sessionPortal: "agent" },
    ],
  ])("rejects %s before upgrade", (_case, input) => {
    expect(checkWebSocketOrigin({ ...input, hasSession: true })).toEqual({
      allowed: false,
      status: 403,
    });
  });

  it("allows an API key to omit Origin but validates one when supplied", () => {
    expect(
      checkWebSocketOrigin({
        host: agent.host,
        origin: null,
        sessionPortal: null,
        hasSession: false,
      }),
    ).toEqual({
      allowed: true,
      portal: "agent",
    });
    expect(
      checkWebSocketOrigin({
        host: agent.host,
        origin: portal.origin,
        sessionPortal: null,
        hasSession: false,
      }),
    ).toEqual({
      allowed: false,
      status: 403,
    });
  });
});
