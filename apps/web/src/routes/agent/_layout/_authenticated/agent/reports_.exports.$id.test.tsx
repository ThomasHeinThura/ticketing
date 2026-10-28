import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/lib/routes";
import { Route as AuthenticatedRoute } from "../../_authenticated";
import { Route as ReportExportRoute } from "./reports_.exports.$id";

const getSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { getSession: (...args: unknown[]) => getSession(...args) },
}));
vi.mock("@/components/reports/report-export-page", () => ({
  ReportExportPage: () => null,
}));

/**
 * P5-R3-01: the "export ready" email links to `/agent/reports/exports/{id}`. The page sits under
 * the authenticated shell, so a signed-out recipient is sent to the normal sign-in with a return
 * to exactly that page, which the sign-in screen accepts as a same-origin path.
 */
describe("report export page route (P5-R3-01)", () => {
  beforeEach(() => {
    getSession.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  });

  it("renders the export page component", () => {
    expect(ReportExportRoute.options.component).toBeTypeOf("function");
  });

  it("sends a signed-out recipient to sign-in and back to the export page", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    const pathname = routes.reportExport.build({ id: "export-1" });
    const search = defaultParseSearch("");
    const beforeLoad = AuthenticatedRoute.options.beforeLoad;
    if (!beforeLoad) throw new Error("_authenticated route has no beforeLoad");
    let thrown: unknown;
    try {
      await beforeLoad({
        location: {
          pathname,
          search,
          searchStr: defaultStringifySearch(search),
          hash: "",
          href: pathname,
          state: {},
        },
      } as unknown as Parameters<typeof beforeLoad>[0]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    const options = (
      thrown as Response & {
        options: { to: string; search: { redirect: string } };
      }
    ).options;
    expect(options.to).toBe("/auth/sign-in");
    expect(options.search.redirect).toBe("/agent/reports/exports/export-1");
    // The sign-in screen's own rule for a safe return path.
    expect(
      options.search.redirect.startsWith("/") &&
        !options.search.redirect.includes("//"),
    ).toBe(true);
  });
});
