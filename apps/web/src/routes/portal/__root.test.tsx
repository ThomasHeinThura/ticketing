import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/portal-auth-client", () => ({ portalAuthClient: auth }));
vi.mock("@/fetchers/feature-flags", () => ({
  getPortalFeatureState: async () => "on",
}));
const router = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => router,
}));

import queryClient from "@/query-client";
import { Route as PortalRootRoute } from "@/routes/portal/__root";

type BeforeLoad = (args: {
  location: { pathname: string; searchStr: string };
}) => Promise<unknown>;
const beforeLoad = PortalRootRoute.options.beforeLoad as unknown as BeforeLoad;

const signedIn = {
  data: {
    session: { id: "s1" },
    user: { id: "u1", name: "Ada Customer", email: "ada@example.test" },
  },
  error: null,
};
const signedOut = { data: null, error: null };

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { options?: { to?: string; search?: unknown } };
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  auth.getSession.mockReset();
  router.invalidate.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("portal root session read", () => {
  it("retries one dropped session request instead of showing the error page", async () => {
    auth.getSession
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(signedIn);
    await expect(
      beforeLoad({ location: { pathname: "/projects/HELP", searchStr: "" } }),
    ).resolves.toMatchObject({ portalUserId: "u1" });
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });

  it("retries a server failure, but treats a refusal as signed out without retrying", async () => {
    auth.getSession
      .mockResolvedValueOnce({ data: null, error: { status: 503 } })
      .mockResolvedValueOnce(signedIn);
    await expect(
      beforeLoad({ location: { pathname: "/requests", searchStr: "" } }),
    ).resolves.toMatchObject({ portalUserId: "u1" });
    expect(auth.getSession).toHaveBeenCalledTimes(2);

    queryClient.clear();
    auth.getSession.mockReset().mockResolvedValue({
      data: null,
      error: { status: 403 },
    });
    const refused = await rejection(
      beforeLoad({ location: { pathname: "/requests", searchStr: "" } }),
    );
    expect(refused.options?.to).toBe("/sign-in");
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });

  it("reads the session once for repeated navigations inside the cache window", async () => {
    auth.getSession.mockResolvedValue(signedIn);
    await beforeLoad({ location: { pathname: "/requests", searchStr: "" } });
    await beforeLoad({ location: { pathname: "/kb", searchStr: "" } });
    await beforeLoad({ location: { pathname: "/", searchStr: "" } });
    expect(auth.getSession).toHaveBeenCalledTimes(1);

    // Sign-in and sign-out clear the whole query cache, so the next read is fresh.
    queryClient.clear();
    await beforeLoad({ location: { pathname: "/", searchStr: "" } });
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });

  it("sends a signed-out visitor to sign-in with the requested page, and never caches signed out", async () => {
    auth.getSession.mockResolvedValue(signedOut);
    const deep = await rejection(
      beforeLoad({
        location: { pathname: "/requests/HELP-6", searchStr: "?tab=activity" },
      }),
    );
    expect(deep.options?.to).toBe("/sign-in");
    expect(deep.options?.search).toEqual({
      stage: "email",
      factor: "totp",
      redirect: "/requests/HELP-6?tab=activity",
    });

    const home = await rejection(
      beforeLoad({ location: { pathname: "/", searchStr: "" } }),
    );
    expect(home.options?.search).toEqual({ stage: "email", factor: "totp" });
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });

  it("Try Again runs the root's session read again before clearing the error", async () => {
    const PortalError = PortalRootRoute.options
      .errorComponent as ComponentType<{
      reset: () => void;
    }>;
    const reset = vi.fn();
    render(<PortalError reset={reset} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "common:actions.tryAgain" }),
    );
    await vi.waitFor(() => expect(reset).toHaveBeenCalled());
    expect(router.invalidate).toHaveBeenCalledTimes(1);
    expect(router.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      reset.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
