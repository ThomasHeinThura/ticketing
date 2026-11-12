import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ErrorReference } from "./error-reference";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, args?: { id?: string }) =>
      key === "common:error.reference"
        ? `Reference: ${args?.id}`
        : "Copy reference",
  }),
}));
afterEach(cleanup);
it("renders and copies a 5xx reference but does not show a 4xx reference", () => {
  const id = "a".repeat(32);
  const writeText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const { rerender } = render(
    <ErrorReference error={new HttpError(503, "unavailable", id)} />,
  );
  expect(screen.getByText(`Reference: ${id}`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy reference" }));
  expect(writeText).toHaveBeenCalledWith(id);
  rerender(<ErrorReference error={new HttpError(403, "forbidden", id)} />);
  expect(screen.queryByText(`Reference: ${id}`)).toBeNull();
});
