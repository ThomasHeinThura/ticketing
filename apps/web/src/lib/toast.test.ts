import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const add = vi.hoisted(() => vi.fn((_value: unknown) => "toast-1"));
vi.mock("@taskdesk/ui", () => ({ toastManager: { add, close: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({
  i18n: {
    t: (key: string, options?: { id?: string }) =>
      key === "common:error.reference"
        ? `Reference: ${options?.id}`
        : "Copy reference",
  },
}));

import { toast } from "./toast";

describe("error toast", () => {
  beforeEach(() => add.mockClear());
  it("offers a copy action for a 5xx reference and omits it for a 4xx", () => {
    const id = "a".repeat(32);
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    toast.error(new HttpError(500, "failure", id));
    const item = add.mock.calls[0]?.[0] as unknown as {
      description: string;
      actionProps: { children: string; onClick: () => void };
    };
    expect(item.description).toBe(`Reference: ${id}`);
    expect(item.actionProps.children).toBe("Copy reference");
    item.actionProps.onClick();
    expect(writeText).toHaveBeenCalledWith(id);
    toast.error(new HttpError(403, "forbidden", id));
    expect(
      (add.mock.calls[1]?.[0] as { actionProps?: unknown } | undefined)
        ?.actionProps,
    ).toBeUndefined();
  });
});
