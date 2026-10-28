import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/portal-auth-client", () => ({ portalAuthClient: auth }));
const portalState = vi.hoisted(() => ({
  get: vi.fn(async () => "on" as "on" | "off" | "unavailable"),
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getPortalFeatureState: portalState.get,
}));

import { readPortalStateMarker } from "@/lib/portal-state";
import queryClient from "@/query-client";
import { Route as PortalRootRoute } from "@/routes/portal/__root";
import { PortalFeatureOff } from "./portal-feature-off";

function setMarker(content: string | null) {
  for (const meta of document.querySelectorAll(
    'meta[name="taskdesk-portal-state"]',
  ))
    meta.remove();
  if (content === null) return;
  const meta = document.createElement("meta");
  meta.setAttribute("name", "taskdesk-portal-state");
  meta.setAttribute("content", content);
  document.head.append(meta);
}

afterEach(() => {
  cleanup();
  setMarker(null);
  auth.getSession.mockReset();
  portalState.get.mockReset().mockResolvedValue("on");
  queryClient.clear();
});

describe("portal feature-off state (P3-R2-03, P4R2-L1)", () => {
  it("reads only the two known markers the host writes", () => {
    expect(readPortalStateMarker()).toBeNull();
    setMarker("disabled");
    expect(readPortalStateMarker()).toBe("disabled");
    setMarker("unavailable");
    expect(readPortalStateMarker()).toBe("unavailable");
    setMarker("<script>");
    expect(readPortalStateMarker()).toBeNull();
  });

  it("disabled: the library empty state with the translated notice and no retry", () => {
    render(<PortalFeatureOff state="disabled" />);
    expect(screen.getByTestId("portal-feature-off-disabled")).toBeTruthy();
    expect(screen.getByText("unavailable.title")).toBeTruthy();
    expect(screen.getByText("unavailable.description")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unavailable: says it is temporary and offers a retry", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<PortalFeatureOff state="unavailable" />);
    expect(screen.getByText("temporarilyUnavailable.title")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.tryAgain" }),
    );
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("the portal root shows the state instead of asking for a session", async () => {
    setMarker("disabled");
    const beforeLoad = PortalRootRoute.options.beforeLoad as unknown as (args: {
      location: { pathname: string };
    }) => Promise<unknown>;
    expect(await beforeLoad({ location: { pathname: "/requests" } })).toEqual({
      portalState: "disabled",
      portalUserId: undefined,
    });
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("after an in-app sign-in the root asks for the organisation's portal state (no reload needed)", async () => {
    const beforeLoad = PortalRootRoute.options.beforeLoad as unknown as (args: {
      location: { pathname: string };
    }) => Promise<unknown>;
    auth.getSession.mockResolvedValue({
      data: { session: { id: "s1" }, user: { id: "u1" } },
      error: null,
    });
    portalState.get.mockResolvedValue("off");
    expect(await beforeLoad({ location: { pathname: "/catalogue" } })).toEqual({
      portalUserId: "u1",
      portalState: "disabled",
    });
    queryClient.clear();
    portalState.get.mockResolvedValue("unavailable");
    expect(await beforeLoad({ location: { pathname: "/catalogue" } })).toEqual({
      portalUserId: "u1",
      portalState: "unavailable",
    });
    queryClient.clear();
    portalState.get.mockResolvedValue("on");
    expect(await beforeLoad({ location: { pathname: "/catalogue" } })).toEqual({
      portalUserId: "u1",
      portalState: null,
    });
    // A failed read leaves the pages to their own states rather than blocking the portal.
    queryClient.clear();
    portalState.get.mockRejectedValue(new Error("network"));
    expect(await beforeLoad({ location: { pathname: "/catalogue" } })).toEqual({
      portalUserId: "u1",
      portalState: null,
    });
  });
});
