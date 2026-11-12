import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

afterEach(() => {
  cleanup();
});

describe("Table", () => {
  it("renders header and body rows as real table semantics", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alpha</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("names an opted-in scroll region without changing table semantics or its label", async () => {
    const { baseElement } = render(
      <Table scrollLabel="Delivery history" aria-label="Delivery rows">
        <TableHeader>
          <TableRow>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Delivered</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const region = screen.getByRole("region", { name: "Delivery history" });
    expect(region).toContainElement(
      screen.getByRole("table", { name: "Delivery rows" }),
    );
    expect(screen.getByRole("cell", { name: "Delivered" })).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });

  it("fades the cut edge of a scrolling table only when asked", () => {
    const { rerender } = render(
      <Table scrollLabel="Wide rows">
        <TableBody>
          <TableRow>
            <TableCell>Alpha</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const viewport = () =>
      screen
        .getByRole("region", { name: "Wide rows" })
        .querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport()?.className).not.toContain("mask-r-from-");
    rerender(
      <Table scrollLabel="Wide rows" scrollFade>
        <TableBody>
          <TableRow>
            <TableCell>Alpha</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(viewport()?.className).toContain("mask-r-from-");
  });

  it("adds shared press feedback only to interactive rows and suppresses scale during drag", () => {
    const onRowClick = vi.fn();
    const { rerender } = render(
      <Table>
        <TableHeader>
          <TableRow data-testid="header-row">
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-testid="static-row">
            <TableCell>Static</TableCell>
          </TableRow>
          <TableRow
            interactive
            data-testid="clickable-row"
            onClick={onRowClick}
          >
            <TableCell>Clickable</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const headerRow = screen.getByTestId("header-row");
    const staticRow = screen.getByTestId("static-row");
    const clickableRow = screen.getByTestId("clickable-row");

    for (const row of [headerRow, staticRow]) {
      expect(row).toHaveClass("transition-colors");
      expect(row).not.toHaveClass("press-feedback", "cursor-pointer");
      expect(row).not.toHaveAttribute("data-interactive");
    }

    expect(clickableRow).toHaveAttribute("data-interactive", "");
    expect(clickableRow).toHaveClass(
      "press-feedback",
      "[--press-scale:0.99]",
      "cursor-pointer",
    );
    expect(clickableRow).not.toHaveClass("transition-colors");

    fireEvent.click(clickableRow);
    expect(onRowClick).toHaveBeenCalledTimes(1);

    const style = document.createElement("style");
    style.textContent = `
      .press-feedback[data-pressed] { scale: var(--press-scale, 0.97); }
      .press-feedback[data-dragging] { scale: none; }
    `;
    document.head.appendChild(style);
    try {
      rerender(
        <Table>
          <TableBody>
            <TableRow
              interactive
              data-dragging=""
              data-pressed=""
              data-testid="clickable-row"
              onClick={onRowClick}
            >
              <TableCell>Clickable</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      expect(getComputedStyle(screen.getByTestId("clickable-row")).scale).toBe(
        "none",
      );
    } finally {
      style.remove();
    }
  });
});
