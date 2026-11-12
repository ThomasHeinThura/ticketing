import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ canManageSettings: false }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children?: React.ReactNode;
  }) => (
    <a {...props} href={to}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => mocks.canManageSettings,
  }),
}));

import { HttpError } from "@/lib/http-error";
import { QueryFailure } from "./shared";

afterEach(() => {
  cleanup();
  mocks.canManageSettings = false;
});

describe("QueryFailure", () => {
  const featureOff = new HttpError(409, "feature_disabled");

  it("explains a switched-off catalogue without Turn on to someone who cannot manage features", () => {
    render(<QueryFailure error={featureOff} onRetry={() => undefined} />);
    expect(screen.getByTestId("service-catalogue-off")).toBeInTheDocument();
    expect(screen.getByText("disabled.description")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives an admin who can manage workspace settings the Turn on action", () => {
    mocks.canManageSettings = true;
    render(<QueryFailure error={featureOff} onRetry={() => undefined} />);
    expect(screen.getByText("disabled.manageDescription")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "common:featureOff.turnOn" }),
    ).toHaveAttribute("href", "/dashboard/settings/workspace/features");
  });

  it("offers Retry for any other failure", () => {
    const onRetry = vi.fn();
    render(<QueryFailure error={new Error("boom")} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("service-catalogue-off")).toBeNull();
  });
});
