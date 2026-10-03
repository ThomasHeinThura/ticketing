import { describe, expect, it } from "vitest";
import { withConfiguredAgentAuthority } from "./agent-authority";

const agentOrigin = "http://localhost:1337";

describe("in-process agent request authority", () => {
  it("normalizes relative requests and exact configured-origin strings", () => {
    const relative = withConfiguredAgentAuthority(
      "/api/project",
      undefined,
      agentOrigin,
    );
    expect(relative.input).toBe("http://localhost:1337/api/project");
    expect(new Headers(relative.init?.headers).get("host")).toBe(
      "localhost:1337",
    );

    const absolute = withConfiguredAgentAuthority(
      "http://localhost:1337/api/upload?token=abc",
      undefined,
      agentOrigin,
    );
    expect(absolute.input).toBe("http://localhost:1337/api/upload?token=abc");
    expect(new Headers(absolute.init?.headers).get("host")).toBe(
      "localhost:1337",
    );
  });

  it("preserves explicit Host values, wrong origins, and non-string inputs", () => {
    const explicitHost = withConfiguredAgentAuthority(
      "http://localhost:1337/api/project",
      { headers: { host: "attacker.example" } },
      agentOrigin,
    );
    expect(new Headers(explicitHost.init?.headers).get("host")).toBe(
      "attacker.example",
    );

    const wrongOrigin = withConfiguredAgentAuthority(
      "http://portal.localhost:5174/api/project",
      undefined,
      agentOrigin,
    );
    expect(wrongOrigin).toEqual({
      input: "http://portal.localhost:5174/api/project",
      init: undefined,
    });

    const request = new Request("http://localhost:1337/api/project");
    expect(
      withConfiguredAgentAuthority(request, undefined, agentOrigin),
    ).toEqual({
      input: request,
      init: undefined,
    });
  });
});
