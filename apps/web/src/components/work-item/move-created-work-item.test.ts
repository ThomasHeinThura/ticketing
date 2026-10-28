import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveCreatedWorkItemToState } from "./move-created-work-item";

const mocks = vi.hoisted(() => ({ offers: vi.fn(), transition: vi.fn() }));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: mocks.offers,
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: mocks.transition,
}));

const offer = (overrides: Record<string, unknown> = {}) => ({
  transitionId: "t-1",
  toStateId: "s-2",
  toStateTemplateId: "st-2",
  toStateName: "Doing",
  toStateCategory: "started",
  notePolicy: "none",
  available: true,
  blockedBy: [],
  ...overrides,
});

beforeEach(() => {
  mocks.offers.mockReset();
  mocks.transition.mockReset().mockResolvedValue({});
});

describe("moveCreatedWorkItemToState (P1R2-2)", () => {
  it("does nothing when the item already starts in the column's state", async () => {
    await expect(
      moveCreatedWorkItemToState({
        key: "WLP-1",
        currentStateId: "s-2",
        targetStateId: "s-2",
      }),
    ).resolves.toBe("already");
    expect(mocks.offers).not.toHaveBeenCalled();
  });

  it("applies the workflow transition a drop onto the column would use", async () => {
    mocks.offers.mockResolvedValue([offer()]);
    await expect(
      moveCreatedWorkItemToState({
        key: "WLP-1",
        currentStateId: "s-1",
        targetStateId: "s-2",
      }),
    ).resolves.toBe("moved");
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "WLP-1",
      toStateTemplateId: "st-2",
    });
  });

  it("leaves the item in its initial state for a missing, blocked or note-required transition", async () => {
    for (const offers of [
      [],
      [offer({ available: false })],
      [offer({ notePolicy: "required" })],
    ]) {
      mocks.offers.mockResolvedValue(offers);
      await expect(
        moveCreatedWorkItemToState({
          key: "WLP-1",
          currentStateId: "s-1",
          targetStateId: "s-2",
        }),
      ).resolves.toBe("unavailable");
    }
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});
