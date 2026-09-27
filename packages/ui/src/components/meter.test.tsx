import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "./meter";

afterEach(() => {
  cleanup();
});

describe("Meter", () => {
  it("exposes the current value to assistive tech", () => {
    render(
      <Meter value={40}>
        <MeterLabel>Disk usage</MeterLabel>
        <MeterValue />
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </Meter>,
    );

    expect(screen.getByRole("meter", { name: "Disk usage" })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Meter value={40}>
        <MeterLabel>Disk usage</MeterLabel>
        <MeterValue />
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      </Meter>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
