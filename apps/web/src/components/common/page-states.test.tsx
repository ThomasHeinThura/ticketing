import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { back: mocks.back } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { LoadErrorState, NoAccessState } from "./page-states";

afterEach(() => {
  cleanup();
  mocks.back.mockReset();
});

describe("NoAccessState", () => {
  it("says what happened and whom to ask, from the translated default texts", () => {
    render(<NoAccessState />);
    expect(
      screen.getByRole("heading", { level: 2, name: "states.noAccess.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("states.noAccess.description")).toBeInTheDocument();
  });

  it("goes back in the browser history from the Back action", () => {
    render(<NoAccessState />);
    fireEvent.click(screen.getByRole("button", { name: "states.back" }));
    expect(mocks.back).toHaveBeenCalledTimes(1);
  });

  it("lets a screen supply its own reason and its own Back", () => {
    const onBack = vi.fn();
    render(
      <NoAccessState
        title="You cannot triage requests"
        description="Ask a lead."
        headingLevel={3}
        onBack={onBack}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "You cannot triage requests",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "states.back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mocks.back).not.toHaveBeenCalled();
  });
});

describe("LoadErrorState", () => {
  it("announces the failure with translated texts and retries on request", () => {
    const onRetry = vi.fn();
    render(<LoadErrorState onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "states.error.title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("states.error.description")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "actions.retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
