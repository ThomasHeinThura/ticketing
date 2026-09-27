import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

afterEach(() => {
  cleanup();
});

describe("Card", () => {
  it("renders header, content and footer together", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Work item #42</CardTitle>
          <CardDescription>Fix the login redirect</CardDescription>
        </CardHeader>
        <CardContent>Assigned to Priya.</CardContent>
        <CardFooter>Updated 2 hours ago</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Work item #42")).toBeInTheDocument();
    expect(screen.getByText("Fix the login redirect")).toBeInTheDocument();
    expect(screen.getByText("Assigned to Priya.")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 hours ago")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Card>
        <CardHeader>
          <CardTitle>Work item #42</CardTitle>
          <CardDescription>Fix the login redirect</CardDescription>
          <CardAction>
            <button type="button">Archive</button>
          </CardAction>
        </CardHeader>
        <CardContent>Assigned to Priya.</CardContent>
      </Card>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
