import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    );
  });
});
