import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "./empty";

afterEach(() => {
  cleanup();
});

describe("Empty", () => {
  it("renders a title and description", () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No work items</EmptyTitle>
          <EmptyDescription>Create one to get started.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button type="button">New work item</button>
        </EmptyContent>
      </Empty>,
    );

    expect(screen.getByText("No work items")).toBeInTheDocument();
    expect(screen.getByText("Create one to get started.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New work item" }),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No work items</EmptyTitle>
          <EmptyDescription>Create one to get started.</EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
