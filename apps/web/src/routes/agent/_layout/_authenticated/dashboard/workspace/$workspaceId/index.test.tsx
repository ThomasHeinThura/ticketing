import { describe, expect, it } from "vitest";
import { Route } from "./index";

type RedirectOptions = { to: string; replace: boolean };

type BeforeLoadArgs = {
  context: { session?: unknown };
  params: { workspaceId: string };
};

/** Runs the route's `beforeLoad`; returns the redirect it throws, or undefined when it opens. */
function redirectFrom(args: BeforeLoadArgs): RedirectOptions | undefined {
  const beforeLoad = Route.options.beforeLoad as
    | ((args: BeforeLoadArgs) => unknown)
    | undefined;
  if (!beforeLoad) throw new Error("workspace index route has no beforeLoad");
  try {
    beforeLoad(args);
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(Response);
    return (thrown as Response & { options: RedirectOptions }).options;
  }
  return undefined;
}

const sessionIn = (activeOrganizationId: string | null) => ({
  session: { activeOrganizationId },
});

describe("old projects list URL /dashboard/workspace/{id}", () => {
  it("redirects to /agent, replacing history, when it is the active workspace", () => {
    const options = redirectFrom({
      context: { session: sessionIn("ws-1") },
      params: { workspaceId: "ws-1" },
    });
    expect(options?.to).toBe("/agent");
    expect(options?.replace).toBe(true);
  });

  it("keeps showing the list of a workspace that is not the active one", () => {
    expect(
      redirectFrom({
        context: { session: sessionIn("ws-2") },
        params: { workspaceId: "ws-1" },
      }),
    ).toBeUndefined();
  });

  it("never redirects when no workspace is active or the session is unknown", () => {
    expect(
      redirectFrom({
        context: { session: sessionIn(null) },
        params: { workspaceId: "ws-1" },
      }),
    ).toBeUndefined();
    expect(
      redirectFrom({ context: {}, params: { workspaceId: "ws-1" } }),
    ).toBeUndefined();
    expect(
      redirectFrom({ context: { session: null }, params: { workspaceId: "" } }),
    ).toBeUndefined();
  });
});
