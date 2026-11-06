import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRouteError } from "./lazy-retry-error";

const invalidate = vi.fn(() => Promise.resolve());

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

const chunkError = new TypeError(
  "Failed to fetch dynamically imported module: https://ticketing.localhost/assets/_key.js",
);

describe("AgentRouteError", () => {
  it("shows the styled chunk screen, reloads once on its own and again on Try again", () => {
    render(<AgentRouteError error={chunkError} reset={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "common:error.messages.chunkLoad",
    );
    expect(screen.queryByText("Something went wrong!")).toBeNull();
    // One automatic reload per failing chunk.
    expect(reload).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "common:error.tryAgain" }),
    );
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload on its own a second time for the same chunk", () => {
    render(<AgentRouteError error={chunkError} reset={vi.fn()} />);
    cleanup();
    reload.mockClear();
    render(<AgentRouteError error={chunkError} reset={vi.fn()} />);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the styled error card for other errors and re-runs the route before clearing it", async () => {
    const reset = vi.fn();
    render(<AgentRouteError error={new Error("boom")} reset={reset} />);

    expect(screen.getByText("common:error.title")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "common:error.tryAgain" }),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  });
});
