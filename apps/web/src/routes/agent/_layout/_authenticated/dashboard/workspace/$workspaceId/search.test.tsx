import { describe, expect, it } from "vitest";
import { Route } from "./search";

type RedirectOptions = {
  to: string;
  search: Record<string, unknown>;
  replace: boolean;
};

/** Runs the route's `beforeLoad` and returns the redirect it throws. */
function redirectFrom(search: Record<string, unknown>): RedirectOptions {
  const beforeLoad = Route.options.beforeLoad as
    | ((args: { search: Record<string, unknown> }) => unknown)
    | undefined;
  if (!beforeLoad) throw new Error("old search route has no beforeLoad");
  let thrown: unknown;
  try {
    beforeLoad({ search });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  return (thrown as Response & { options: RedirectOptions }).options;
}

describe("old workspace search URL /dashboard/workspace/{id}/search", () => {
  it("redirects to /agent/search with replace and keeps the query and scope", () => {
    const search = { q: "HELP-24", scope: "projects" };
    const options = redirectFrom(search);
    expect(options.to).toBe("/agent/search");
    expect(options.replace).toBe(true);
    expect(options.search).toEqual(search);
  });

  it("redirects a bare search URL too", () => {
    const options = redirectFrom({});
    expect(options.to).toBe("/agent/search");
    expect(options.search).toEqual({});
  });
});
