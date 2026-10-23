import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const fakeSubmissionsQuery = vi.hoisted(() => ({
  data: {
    page: { hasMore: true, nextCursor: "older-50" },
    submissions: [
      {
        ref: "REQ-101",
        requestTypeName: "Laptop Request",
        state: "submitted",
        customerStatus: "resolved",
        customerVisibility: "organisation",
        createdAt: "2026-10-21T12:00:00.000Z",
      },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/fetchers/intake", () => ({
  getPortalSubmissions: () => fakeSubmissionsQuery.data,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => fakeSubmissionsQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) =>
    Object.assign(config.component, {
      useRouteContext: () => ({ portalUserId: "customer-a" }),
      useSearch: () => ({}),
      fullPath: "/requests",
    }),
  useNavigate: () => navigate,
  Link: ({ children, to }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue || key,
  }),
}));

import { Route } from "./requests";

describe("PortalRequestsPage", () => {
  afterEach(cleanup);

  it("renders submission rows for the customer", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);

    expect(screen.getByRole("heading", { name: "My requests" })).toBeTruthy();
    expect(screen.getByText("REQ-101")).toBeTruthy();
    expect(screen.getByText("Laptop Request")).toBeTruthy();
    expect(screen.getByText("request.status.resolved")).toBeTruthy();
    expect(screen.queryByText("submitted")).toBeNull();
  });
  it("follows the server cursor for requests beyond the first page", () => {
    const Component = Route as unknown as React.ComponentType;
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: "requests.older" }));
    expect(navigate).toHaveBeenCalledWith({ search: { cursor: "older-50" } });
    expect(
      screen.getByRole("link", { name: "New request" }).querySelector("button"),
    ).toBeNull();
  });
});
