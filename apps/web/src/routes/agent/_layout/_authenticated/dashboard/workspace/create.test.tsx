import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./create";

type Guard = (args: { context: { session: unknown } }) => void;

function runGuard(session: unknown): unknown {
  const beforeLoad = Route.options.beforeLoad as unknown as Guard;
  try {
    beforeLoad({ context: { session } });
    return null;
  } catch (thrown) {
    return thrown;
  }
}

describe("/dashboard/workspace/create guard (D-A, 12 Nov 2026)", () => {
  it("sends anyone who is not an instance admin to the agent home", () => {
    for (const session of [
      null,
      { user: { id: "u-1" } },
      { user: { id: "u-1", role: "user" } },
    ]) {
      const thrown = runGuard(session);
      expect(isRedirect(thrown), JSON.stringify(session)).toBe(true);
      expect(thrown).toMatchObject({ options: { to: "/agent" } });
    }
  });

  it("lets an instance admin open the create screen", () => {
    expect(runGuard({ user: { id: "u-1", role: "admin" } })).toBeNull();
  });
});
