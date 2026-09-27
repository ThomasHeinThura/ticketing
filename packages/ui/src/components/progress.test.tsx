import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "./progress";

afterEach(() => {
  cleanup();
});

describe("Progress", () => {
  it("exposes the current value to assistive tech", () => {
    render(
      <Progress value={40}>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>,
    );

    expect(
      screen.getByRole("progressbar", { name: "Uploading" }),
    ).toHaveAttribute("aria-valuenow", "40");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Progress value={40}>
        <ProgressLabel>Uploading</ProgressLabel>
        <ProgressValue />
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
