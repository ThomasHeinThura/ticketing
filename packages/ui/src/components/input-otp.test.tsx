import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "./input-otp";

// jsdom does not implement this; the underlying `input-otp` library uses it to measure
// character width.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function waitForInputOtpSelectionTimers() {
  const input = screen.getByRole("textbox");
  let inputEvents = 0;
  const countInputEvent = () => {
    inputEvents += 1;
  };
  input.addEventListener("input", countInputEvent);

  await waitFor(() => {
    expect(inputEvents).toBe(3);
  });

  input.removeEventListener("input", countInputEvent);
}

describe("InputOTP", () => {
  it("renders a hidden text input plus the requested number of slots", async () => {
    render(
      <InputOTP maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSeparator />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>,
    );

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await waitForInputOtpSelectionTimers();
  });

  it("reflects a pre-filled value in its slots", async () => {
    render(
      <InputOTP maxLength={4} value="12">
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    await waitForInputOtpSelectionTimers();
  });

  it("has no accessibility violations when the code input has a label", async () => {
    const { baseElement } = render(
      <InputOTP aria-label="Verification code" maxLength={4}>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
          <InputOTPSlot index={3} />
        </InputOTPGroup>
      </InputOTP>,
    );

    await waitForInputOtpSelectionTimers();
    await expectNoA11yViolations(baseElement);
  });
});
