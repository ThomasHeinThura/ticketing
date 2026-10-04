import { describe, expect, it } from "vitest";
import { getRequestTypeErrorMessage } from "./request-type";

describe("request type API error messages", () => {
  it("extracts an actionable message from a JSON validation or conflict response", () => {
    expect(
      getRequestTypeErrorMessage(
        new Error(
          JSON.stringify({
            message: "The selected project is outside the request workspace.",
          }),
        ),
        "Action unavailable",
      ),
    ).toBe("The selected project is outside the request workspace.");
  });

  it("preserves plain text errors and uses a safe fallback for non-errors", () => {
    expect(
      getRequestTypeErrorMessage(new Error("Not authorized"), "Fallback"),
    ).toBe("Not authorized");
    expect(getRequestTypeErrorMessage({ message: "secret" }, "Fallback")).toBe(
      "Fallback",
    );
  });
});
