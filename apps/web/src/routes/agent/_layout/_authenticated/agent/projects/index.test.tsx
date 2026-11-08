import { describe, expect, it } from "vitest";
import { Route as ProjectsIndexRoute } from "./index";

type RedirectOptions = {
  to: string;
  search: Record<string, unknown>;
  replace: boolean;
};

/** Runs the route's `beforeLoad` and returns the redirect it throws. */
function redirectFrom(search: Record<string, unknown>): RedirectOptions {
  const beforeLoad = ProjectsIndexRoute.options.beforeLoad as
    | ((args: { search: Record<string, unknown> }) => unknown)
    | undefined;
  if (!beforeLoad) throw new Error("projects index route has no beforeLoad");
  let thrown: unknown;
  try {
    beforeLoad({ search });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  return (thrown as Response & { options: RedirectOptions }).options;
}

describe("bare /agent/projects URL (UX-8)", () => {
  it("redirects to the projects list with replace and keeps the query", () => {
    const search = { kind: "service" };
    const options = redirectFrom(search);
    expect(options.to).toBe("/agent");
    expect(options.replace).toBe(true);
    expect(options.search).toEqual(search);
  });
});
