import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./_authenticated";

const getSession = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => getSession(...args),
  },
}));

/**
 * Builds a `ParsedLocation` the way TanStack Router's own
 * `Router.parseLocation` actually builds one (see @tanstack/router-core's
 * `router.js` `parse()`): `search` is the *parsed* search object, and
 * `href` is `pathname + searchStr + hash`.
 *
 * Using the router's real `defaultParseSearch`/`defaultStringifySearch`
 * here (rather than a hand-rolled `{ pathname, search: {}, hash }` stub) is
 * what actually reproduces #97: `defaultParseSearch("")` returns an object
 * built with `Object.create(null)` (see router-core's `qss.ts` `decode`),
 * which has no prototype at all. A plain `{}` stub would concatenate into
 * a string just fine and would never have caught this bug.
 */
function buildRealLocation(pathname: string, rawSearch: string, hash: string) {
  const search = defaultParseSearch(rawSearch);
  const searchStr = defaultStringifySearch(search);
  return {
    pathname,
    search,
    searchStr,
    hash,
    href: pathname + searchStr + hash,
    state: {},
  };
}

describe("_authenticated route beforeLoad", () => {
  beforeEach(() => {
    getSession.mockReset();
  });

  it("fixture reproduces the actual defect: an empty query string parses to a null-prototype object that throws on concatenation", () => {
    const location = buildRealLocation("/dashboard", "", "");

    expect(Object.getPrototypeOf(location.search)).toBeNull();
    // This is the exact throw from #97's repro ("Cannot convert object to
    // primitive value"), reproduced with the router's real parsed search
    // object rather than asserted against a mock.
    expect(
      () => `${location.pathname}${location.search}${location.hash}`,
    ).toThrow(TypeError);
  });

  it("redirects a logged-out user visiting a protected route to sign-in with a well-formed redirect target", async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    const location = buildRealLocation("/dashboard", "", "");
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    let thrown: unknown;
    try {
      await beforeLoad({ location } as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }

    // Before the fix, `thrown` was a `TypeError` from the concatenation
    // above and the redirect never happened — this is the assertion that
    // catches a regression back to that behavior, not just "it threw
    // something".
    expect(thrown).toBeInstanceOf(Response);
    const redirectOptions = (
      thrown as Response & {
        options: { to: string; search: { redirect: string } };
      }
    ).options;
    expect(redirectOptions.to).toBe("/auth/sign-in");
    expect(redirectOptions.search.redirect).toBe("/dashboard");
  });

  it("also produces a well-formed redirect target when the protected route has a query string and hash", async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    const location = buildRealLocation(
      "/dashboard/workspace/w1",
      "?tab=board",
      "#task-42",
    );
    const beforeLoad = Route.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");

    let thrown: unknown;
    try {
      await beforeLoad({ location } as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    const redirectOptions = (
      thrown as Response & {
        options: { to: string; search: { redirect: string } };
      }
    ).options;
    expect(redirectOptions.search.redirect).toBe(
      "/dashboard/workspace/w1?tab=board#task-42",
    );
  });
});
