import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Avatar, AvatarFallback } from "./avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("renders its caller-supplied fallback without accessibility violations", async () => {
    const { baseElement } = render(
      <Avatar>
        <AvatarFallback>AM</AvatarFallback>
      </Avatar>,
    );

    expect(screen.getByText("AM")).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
});
