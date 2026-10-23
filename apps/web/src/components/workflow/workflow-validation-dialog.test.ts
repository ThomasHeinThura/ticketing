import { describe, expect, it } from "vitest";
import { projectProblemMessages } from "./workflow-validation-dialog";

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}${options?.state ? `:${options.state}` : ""}`;
const states = [{ id: "stc_1", name: "Open" }];

describe("projectProblemMessages (WF-9)", () => {
  it("names the state in known API errors instead of its id", () => {
    expect(
      projectProblemMessages(
        [
          "no default state selected",
          "default state stc_1 is not one of the project's enabled states",
          "state stc_1 has no outbound transition in this workflow",
          "state stc_zz has no outbound transition in this workflow",
        ],
        states,
        t,
      ),
    ).toEqual([
      "settings:workflows.validation.noDefaultState",
      "settings:workflows.validation.defaultNotEnabled:Open",
      "settings:workflows.validation.stateNoOutbound:Open",
      "settings:workflows.validation.stateNoOutbound:settings:workflows.validation.unknownState",
    ]);
  });

  it("replaces ids inside any other message", () => {
    expect(projectProblemMessages(["odd stc_1 problem"], states, t)).toEqual([
      "odd Open problem",
    ]);
  });
});
