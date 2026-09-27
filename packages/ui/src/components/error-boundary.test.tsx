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
  it.each([undefined, null, 0, ""])(
    "renders the fallback when a child throws the falsy value %s",
    (thrown) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      function Child() {
        throw thrown;
      }

      render(
        <ErrorBoundary fallback={Fallback}>
          <Child />
        </ErrorBoundary>,
      );

      expect(screen.getByRole("alert")).toHaveTextContent(String(thrown));
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    },
  );

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
