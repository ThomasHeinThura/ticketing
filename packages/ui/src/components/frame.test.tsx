import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "./frame";

afterEach(() => {
  cleanup();
});

describe("Frame", () => {
  it("renders a panel with a header, title, description and footer", () => {
    render(
      <Frame>
        <FramePanel>
          <FrameHeader>
            <FrameTitle>Workspace settings</FrameTitle>
            <FrameDescription>
              Manage who can access this workspace.
            </FrameDescription>
          </FrameHeader>
          <FrameFooter>Last updated 2 days ago.</FrameFooter>
        </FramePanel>
      </Frame>,
    );

    expect(screen.getByText("Workspace settings")).toBeInTheDocument();
    expect(
      screen.getByText("Manage who can access this workspace."),
    ).toBeInTheDocument();
    expect(screen.getByText("Last updated 2 days ago.")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Frame>
        <FramePanel>
          <FrameHeader>
            <FrameTitle>Workspace settings</FrameTitle>
            <FrameDescription>
              Manage who can access this workspace.
            </FrameDescription>
          </FrameHeader>
        </FramePanel>
      </Frame>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
