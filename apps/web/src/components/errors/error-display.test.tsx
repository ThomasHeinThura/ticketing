import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { ErrorDisplay } from "./error-display";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorDisplay", () => {
  it("opens the deployment guide on the canonical Bimats product host", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<ErrorDisplay error={new Error("CORS blocked the request")} />);

    screen
      .getByRole("button", {
        name: "common:error.viewDeploymentGuide",
      })
      .click();

    expect(open).toHaveBeenCalledWith(
      "https://taskdesk.bimats.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

it("shows a server reference but not a client error reference", () => {
  const id = "a".repeat(32);
  const { rerender } = render(
    <ErrorDisplay error={new HttpError(500, "failed", id)} />,
  );
  expect(screen.getByText("common:error.reference")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "common:error.copyReference" }),
  ).toBeTruthy();
  rerender(<ErrorDisplay error={new HttpError(403, "forbidden", id)} />);
  expect(screen.queryByText("common:error.reference")).toBeNull();
});
