import { describe, expect, it } from "vitest";
import { Route as KnowledgeBaseRoute } from "./knowledge-base";
import { Route as SettingsRoute } from "./settings";

type RedirectOptions = { href: string; replace: boolean };

/** Runs a route's `beforeLoad` and returns the redirect it throws. */
function redirectFrom(
  route: { options: { beforeLoad?: unknown } },
  searchStr: string,
): RedirectOptions {
  const beforeLoad = route.options.beforeLoad as
    | ((args: { location: { searchStr: string } }) => unknown)
    | undefined;
  if (!beforeLoad) throw new Error("redirect route has no beforeLoad");
  let thrown: unknown;
  try {
    beforeLoad({ location: { searchStr } });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  return (thrown as Response & { options: RedirectOptions }).options;
}

describe("portal addresses customers guess or bookmark (UX-8, CP-12)", () => {
  it.each([
    ["/settings", SettingsRoute, "/account"],
    ["/knowledge-base", KnowledgeBaseRoute, "/kb"],
  ] as const)(
    "%s redirects to %s with replace and keeps the query",
    (_url, route, target) => {
      expect(redirectFrom(route, "?project=HELP")).toEqual(
        expect.objectContaining({
          href: `${target}?project=HELP`,
          replace: true,
        }),
      );
      expect(redirectFrom(route, "").href).toBe(target);
    },
  );
});
