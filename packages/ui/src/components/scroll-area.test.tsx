import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea", () => {
  it("renders its children inside the scrollable viewport", () => {
    render(
      <ScrollArea>
        <div>Scrollable content</div>
      </ScrollArea>,
    );
    expect(screen.getByText("Scrollable content")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="scroll-area-content"]'),
    ).toBeNull();
  });

  it("watches its content's size when asked, without widening to its widest child", () => {
    render(
      <ScrollArea observeContent>
        <div>Fitted chart</div>
      </ScrollArea>,
    );
    const content = screen
      .getByText("Fitted chart")
      .closest<HTMLElement>('[data-slot="scroll-area-content"]');
    expect(content).not.toBeNull();
    expect(content?.parentElement?.dataset.slot).toBe("scroll-area-viewport");
    expect(content?.style.minWidth).toBe("0px");
  });
});
