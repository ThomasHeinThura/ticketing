import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { ShortcutNumber } from "./shortcut-number";

afterEach(cleanup);

describe("ShortcutNumber", () => {
  it("keeps the shortcut hint hidden from assistive technology", async () => {
    const { baseElement } = render(
      <Button aria-label="Open search" variant="outline">
        Open search
        <ShortcutNumber number={1} />
      </Button>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
