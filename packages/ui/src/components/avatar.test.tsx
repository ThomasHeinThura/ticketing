import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Avatar", () => {
  it("renders the fallback while the image is unavailable", () => {
    render(
      <Avatar>
        <AvatarImage alt="Thomas Hein Thura" src="" />
        <AvatarFallback>TH</AvatarFallback>
      </Avatar>,
    );

    expect(screen.getByText("TH")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders a loaded image with its alt text", () => {
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        naturalWidth = 64;
        src = "";
      },
    );

    render(
      <Avatar>
        <AvatarImage alt="Thomas Hein Thura" src="/avatar.png" />
        <AvatarFallback>TH</AvatarFallback>
      </Avatar>,
    );

    const image = screen.getByRole("img", { name: "Thomas Hein Thura" });
    expect(image).toHaveAttribute("src", "/avatar.png");
    expect(image).toBeVisible();
  });

  it("applies shared and caller classes and exposes the primitive slots", () => {
    const { container } = render(
      <Avatar className="size-10">
        <AvatarFallback className="text-foreground">TH</AvatarFallback>
      </Avatar>,
    );

    const root = container.querySelector('[data-slot="avatar"]');
    const fallback = container.querySelector('[data-slot="avatar-fallback"]');
    expect(root).toHaveClass("size-10", "rounded-full", "overflow-hidden");
    expect(fallback).toHaveClass("text-foreground", "bg-muted");
  });

  it("has no accessibility violations with a named image and fallback", async () => {
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        naturalWidth = 64;
        src = "";
      },
    );

    const { baseElement } = render(
      <Avatar>
        <AvatarImage alt="Thomas Hein Thura" src="/avatar.png" />
        <AvatarFallback>TH</AvatarFallback>
      </Avatar>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
