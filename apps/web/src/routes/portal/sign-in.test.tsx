import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalUnavailableNotice } from "./__root";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  createRootRoute: () => (options: unknown) => options,
  Outlet: () => null,
}));

afterEach(cleanup);

describe("PortalSignIn", () => {
  it("does not expose an unscoped customer credential provider", () => {
    render(<PortalUnavailableNotice />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByLabelText(/email|password/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
