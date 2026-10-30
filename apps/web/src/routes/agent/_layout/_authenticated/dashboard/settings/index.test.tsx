import { describe, expect, it } from "vitest";
import { Route as AccountIndexRoute } from "./account/index";
import { Route as SettingsIndexRoute } from "./index";
import { Route as WorkspaceIndexRoute } from "./workspace/index";

type RedirectOptions = {
  to: string;
  search: Record<string, unknown>;
  replace: boolean;
};

/** Runs a route's `beforeLoad` and returns the redirect it throws. */
function redirectFrom(
  route: { options: { beforeLoad?: unknown } },
  search: Record<string, unknown>,
): RedirectOptions {
  const beforeLoad = route.options.beforeLoad as
    | ((args: { search: Record<string, unknown> }) => unknown)
    | undefined;
  if (!beforeLoad) throw new Error("index route has no beforeLoad");
  let thrown: unknown;
  try {
    beforeLoad({ search });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  return (thrown as Response & { options: RedirectOptions }).options;
}

describe("bare settings URLs (L-03)", () => {
  it.each([
    [
      "/dashboard/settings",
      SettingsIndexRoute,
      "/dashboard/settings/account/information",
    ],
    [
      "/dashboard/settings/account",
      AccountIndexRoute,
      "/dashboard/settings/account/information",
    ],
    [
      "/dashboard/settings/workspace",
      WorkspaceIndexRoute,
      "/dashboard/settings/workspace/general",
    ],
  ] as const)(
    "%s redirects with replace and keeps the query",
    (_url, route, target) => {
      const search = { from: "palette" };
      const options = redirectFrom(route, search);
      expect(options.to).toBe(target);
      expect(options.replace).toBe(true);
      expect(options.search).toEqual(search);
    },
  );
});
