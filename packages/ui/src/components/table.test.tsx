import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
