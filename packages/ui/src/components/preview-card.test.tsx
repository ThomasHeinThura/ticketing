import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "./preview-card";

afterEach(() => {
  cleanup();
});

describe("PreviewCard", () => {
  it("does not render the popup content when closed", () => {
    render(
      <PreviewCard>
        <PreviewCardTrigger>Hover me</PreviewCardTrigger>
        <PreviewCardPopup>Preview details</PreviewCardPopup>
      </PreviewCard>,
    );

    expect(screen.getByText("Hover me")).toBeInTheDocument();
    expect(screen.queryByText("Preview details")).not.toBeInTheDocument();
  });

  it("renders the popup content when open is controlled true", () => {
    render(
      <PreviewCard open>
        <PreviewCardTrigger>Hover me</PreviewCardTrigger>
        <PreviewCardPopup>Preview details</PreviewCardPopup>
      </PreviewCard>,
    );

    // Not `toBeVisible()`: jsdom has no layout engine, so Base UI's positioner keeps
    // the popup at `opacity: 0` until it can measure real geometry, which never
    // happens under jsdom. Presence in the document is what this test can assert.
    expect(screen.getByText("Preview details")).toBeInTheDocument();
  });
});
