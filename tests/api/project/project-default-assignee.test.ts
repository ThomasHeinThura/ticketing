import { describe, expect, it } from "vitest";
import { chooseDefaultAssignee } from "../../../apps/api/src/project/default-assignee";

const eligible = () => true;
const ineligible = () => false;

describe("default assignee precedence (AS-11, AS-12)", () => {
  it("applies the project default when the request type has none", () => {
    expect(
      chooseDefaultAssignee({
        projectDefaultAssigneeId: "proj",
        requestTypeDefaultAssigneeId: null,
        isEligible: eligible,
      }),
    ).toEqual({ assigneeId: "proj" });
  });

  it("lets the request type override the project", () => {
    expect(
      chooseDefaultAssignee({
        projectDefaultAssigneeId: "proj",
        requestTypeDefaultAssigneeId: "rt",
        isEligible: eligible,
      }),
    ).toEqual({ assigneeId: "rt" });
  });

  it("leaves the item unassigned when neither is set", () => {
    expect(
      chooseDefaultAssignee({
        projectDefaultAssigneeId: null,
        requestTypeDefaultAssigneeId: null,
        isEligible: eligible,
      }),
    ).toEqual({ assigneeId: null, reason: "no_default" });
  });

  it("leaves the item unassigned, without falling back, when the chosen default is ineligible", () => {
    const seen: string[] = [];
    expect(
      chooseDefaultAssignee({
        projectDefaultAssigneeId: "proj",
        requestTypeDefaultAssigneeId: "rt",
        isEligible: (id) => {
          seen.push(id);
          return ineligible();
        },
      }),
    ).toEqual({ assigneeId: null, reason: "default_inactive" });
    expect(seen).toEqual(["rt"]);
  });
});
