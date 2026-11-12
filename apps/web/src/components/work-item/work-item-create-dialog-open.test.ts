import { describe, expect, it } from "vitest";
import {
  isWorkItemCreateDialogOpen,
  markWorkItemCreateDialogOpen,
} from "./work-item-create-dialog-open";

describe("work-item create dialog open flag", () => {
  it("is on from mount until the dialog is released", () => {
    expect(isWorkItemCreateDialogOpen()).toBe(false);
    const release = markWorkItemCreateDialogOpen();
    expect(isWorkItemCreateDialogOpen()).toBe(true);
    release();
    expect(isWorkItemCreateDialogOpen()).toBe(false);
  });

  it("stays on while any of several dialogs is still up", () => {
    const first = markWorkItemCreateDialogOpen();
    const second = markWorkItemCreateDialogOpen();
    first();
    expect(isWorkItemCreateDialogOpen()).toBe(true);
    second();
    expect(isWorkItemCreateDialogOpen()).toBe(false);
  });

  it("counts a dialog once however often it is released", () => {
    const first = markWorkItemCreateDialogOpen();
    const second = markWorkItemCreateDialogOpen();
    first();
    first();
    expect(isWorkItemCreateDialogOpen()).toBe(true);
    second();
    expect(isWorkItemCreateDialogOpen()).toBe(false);
  });
});
