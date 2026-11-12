import { afterEach, describe, expect, it, vi } from "vitest";

const add = vi.hoisted(() => vi.fn((_options: unknown) => "toast"));
vi.mock("@taskdesk/ui", () => ({ toastManager: { add } }));
vi.mock("i18next", () => ({
  default: { t: () => "Could not copy. Select and copy the reference below." },
}));

import { copyErrorReference } from "./copy-error-reference";

afterEach(() => {
  vi.clearAllMocks();
});
describe("copyErrorReference", () => {
  it.each(["missing", "rejected"])(
    "offers selectable manual copy when clipboard is %s",
    async (condition) => {
      const reference = "a".repeat(32);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          condition === "missing"
            ? undefined
            : { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      });
      await expect(copyErrorReference(reference)).resolves.toBeUndefined();
      expect(add).toHaveBeenCalledTimes(1);
      const options = add.mock.calls[0]?.[0] as {
        title: string;
        timeout: number;
        description: { props: { className: string; children: string } };
      };
      expect(options.title).toContain("Could not copy");
      expect(options.timeout).toBe(0);
      expect(options.description.props).toMatchObject({
        className: "select-text",
        children: reference,
      });
    },
  );
});
