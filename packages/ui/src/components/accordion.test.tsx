import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "./accordion";

afterEach(() => {
  cleanup();
});

describe("Accordion", () => {
  it("expands a panel when its trigger is clicked", () => {
    render(
      <Accordion>
        <AccordionItem value="one">
          <AccordionTrigger>Section one</AccordionTrigger>
          <AccordionPanel>Panel one content</AccordionPanel>
        </AccordionItem>
      </Accordion>,
    );

    const trigger = screen.getByRole("button", { name: "Section one" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Panel one content")).toBeVisible();
  });
});
