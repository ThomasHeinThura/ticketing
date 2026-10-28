import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildArrowPaths,
  GanttDependencyArrows,
} from "./gantt-dependency-arrows";

afterEach(cleanup);

const bars = new Map([
  ["A-1", { left: 0, right: 100, top: 0, bottom: 40 }],
  ["A-2", { left: 200, right: 260, top: 50, bottom: 90 }],
  ["A-3", { left: 50, right: 90, top: 100, bottom: 140 }],
]);

describe("buildArrowPaths (VW-28)", () => {
  it("draws an elbow from the source's right edge to the target's left edge", () => {
    const [path] = buildArrowPaths(
      [{ id: "e1", type: "blocks", sourceKey: "A-1", targetKey: "A-2" }],
      bars,
    );
    expect(path?.d).toBe("M 100 20 H 150 V 70 H 200");
  });

  it("routes around the target when it starts before the source ends", () => {
    const [path] = buildArrowPaths(
      [{ id: "e2", type: "precedes", sourceKey: "A-1", targetKey: "A-3" }],
      bars,
    );
    expect(path?.d.startsWith("M 100 20 H 110")).toBe(true);
    expect(path?.d.endsWith("H 50")).toBe(true);
  });

  it("skips edges whose ends are not both on the chart", () => {
    expect(
      buildArrowPaths(
        [
          {
            id: "e3",
            type: "blocks",
            sourceKey: "A-1",
            targetKey: "ELSEWHERE-9",
          },
        ],
        bars,
      ),
    ).toEqual([]);
  });
});

describe("GanttDependencyArrows", () => {
  it("renders nothing without paths", () => {
    const { container } = render(
      <GanttDependencyArrows paths={[]} width={10} height={10} label="deps" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("marks blocks solid and precedes dashed, with an accessible name", () => {
    render(
      <GanttDependencyArrows
        paths={[
          { id: "a", type: "blocks", d: "M 0 0 H 10" },
          { id: "b", type: "precedes", d: "M 0 5 H 10" },
        ]}
        width={100}
        height={100}
        label="Dependency arrows"
      />,
    );
    const svg = screen.getByRole("img", { name: "Dependency arrows" });
    const blocks = svg.querySelector('[data-dependency-type="blocks"]');
    const precedes = svg.querySelector('[data-dependency-type="precedes"]');
    expect(blocks?.getAttribute("stroke-dasharray")).toBeNull();
    expect(precedes?.getAttribute("stroke-dasharray")).toBe("5 3");
  });
});
