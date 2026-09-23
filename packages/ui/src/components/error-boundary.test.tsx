import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
} from "./error-boundary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Fallback({ error, resetError }: ErrorBoundaryFallbackProps) {
  return (
    <div>
      <p role="alert">{error.message}</p>
      <button onClick={resetError} type="button">
        Retry
      </button>
    </div>
  );
}

describe("ErrorBoundary", () => {
  it("renders the supplied fallback and lets it reset the boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function Child() {
      if (shouldThrow) throw new Error("render failed");
      return <p>Recovered</p>;
    }

    render(
      <ErrorBoundary fallback={Fallback}>
        <Child />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("render failed");
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
