import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { Group, GroupSeparator, GroupText } from "./group";

afterEach(() => {
  cleanup();
});

describe("Group", () => {
  it("renders its children in the given orientation", () => {
    render(
      <Group orientation="vertical">
        <Button variant="secondary">Left</Button>
        <Button variant="secondary">Right</Button>
      </Group>,
    );

    const group = screen.getByText("Left").closest("[data-slot='group']");
    expect(group).toHaveAttribute("data-orientation", "vertical");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Group>
        <GroupText>https://</GroupText>
        <GroupSeparator />
        <Button variant="secondary">example.com</Button>
      </Group>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
