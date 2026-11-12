import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { id?: string }) =>
      key === "common:error.reference" ? `Reference: ${args?.id}` : key,
    i18n: undefined,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getPortalFeatureState: async () => "on",
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate: vi.fn().mockResolvedValue(undefined) }),
}));

import queryClient from "@/query-client";
import { Route } from "./__root";

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});
it("keeps the session failure reference through the real portal client and root boundary", async () => {
  const id = "b".repeat(32);
  const listener = vi.fn();
  window.addEventListener("taskdesk:server-error", listener);
  const body = JSON.stringify({ message: "private secret", requestId: id });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(body, {
          status: 503,
          headers: {
            "content-type": "application/json",
            "content-length": String(new TextEncoder().encode(body).byteLength),
          },
        }),
    ),
  );
  const beforeLoad = Route.options.beforeLoad as unknown as (input: {
    location: { pathname: string; searchStr: string };
  }) => Promise<unknown>;
  const error = await beforeLoad({
    location: { pathname: "/requests", searchStr: "" },
  }).catch((caught: unknown) => caught);
  await vi.waitFor(() => expect(listener).toHaveBeenCalled());
  expect(
    (listener.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail,
  ).toEqual({ reference: id, status: 503 });
  expect(error).toMatchObject({
    status: 503,
    requestId: id,
    message: "session_unavailable",
  });
  const Boundary = Route.options.errorComponent as ComponentType<{
    error: unknown;
    reset: () => void;
  }>;
  render(<Boundary error={error} reset={() => {}} />);
  expect(await screen.findByText(`Reference: ${id}`)).toBeTruthy();
  expect(document.body.textContent).not.toContain("private secret");
  window.removeEventListener("taskdesk:server-error", listener);
});
