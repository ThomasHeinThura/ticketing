import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

afterEach(() => {
  cleanup();
});

describe("Tooltip", () => {
  it("does not render the popup content when closed", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Helpful info</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.getByText("Hover me")).toBeInTheDocument();
    expect(screen.queryByText("Helpful info")).not.toBeInTheDocument();
  });

  it("renders the popup content when open is controlled true", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Helpful info</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    // Not `toBeVisible()`: jsdom has no layout engine, so the Base UI positioner
    // sets `opacity: 0` inline until it can measure real geometry (which never
    // happens under jsdom) — a real browser removes that as soon as it positions
    // the popup. Presence in the document (portal rendered, popup mounted with
    // `data-open`) is what this test can actually assert here.
    expect(screen.getByText("Helpful info")).toBeInTheDocument();
  });
});
