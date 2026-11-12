import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "../components/badge";
import { Card } from "../components/card";
import { Checkbox } from "../components/checkbox";
import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuTrigger,
} from "../components/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/popover";
import { Skeleton } from "../components/skeleton";
import { Spinner } from "../components/spinner";
import { Switch } from "../components/switch";
import { Tabs, TabsList, TabsTab } from "../components/tabs";
import { ToastProvider, toastManager } from "../components/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/tooltip";
import { mountCompiledMotionStyles } from "../test/compile-motion-css";

afterEach(cleanup);

/** jsdom does not evaluate media queries. Extract the compiled reduce rule and apply
 * it as the active stylesheet, as a browser does when the preference matches. */
function emulateReducedMotion(css: string): HTMLStyleElement {
  const marker = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  const rules: string[] = [];
  for (const match of css.matchAll(marker)) {
    const open = match.index + match[0].length - 1;
    let depth = 1;
    let end = open + 1;
    for (; end < css.length && depth; end++) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
    }
    rules.push(css.slice(open + 1, end - 1));
  }
  expect(rules.length).toBeGreaterThan(0);
  const style = document.createElement("style");
  style.textContent = rules.join("\n");
  document.head.append(style);
  return style;
}

describe("compiled reduced motion CSS", () => {
  it("uses motion tokens in checkbox, badge, switch, tooltip and popover", () => {
    render(
      <>
        <Checkbox aria-label="Accept" />
        <Badge>Badge</Badge>
        <Switch aria-label="Switch" />
        <Popover open>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverPopup>Popover body</PopoverPopup>
        </Popover>
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Hover</TooltipTrigger>
            <TooltipContent>Tooltip body</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>,
    );
    expect(screen.getByRole("checkbox")).toHaveClass("duration-fast");
    expect(
      document.querySelector('[data-slot="checkbox-indicator"]'),
    ).toHaveClass("duration-fast");
    expect(screen.getByText("Badge")).toHaveClass("duration-fast");
    const thumb = document.querySelector('[data-slot="switch-thumb"]');
    expect(thumb?.className).toContain(
      "scale_var(--duration-fast)_var(--ease-out)_var(--duration-fast)",
    );
    for (const slot of [
      "popover-positioner",
      "popover-popup",
      "tooltip-positioner",
      "tooltip-popup",
    ]) {
      expect(document.querySelector(`[data-slot="${slot}"]`)).toHaveClass(
        "duration-fast",
      );
    }
    for (const slot of ["popover-viewport", "tooltip-viewport"]) {
      expect(
        document.querySelector(`[data-slot="${slot}"]`)?.className,
      ).toContain("data-current:duration-fast");
    }
  });

  it("stops checkbox, badge, switch, tooltip and popover transitions under reduced motion", async () => {
    const compiled = await mountCompiledMotionStyles([
      "duration-fast",
      "duration-base",
      "transition-opacity",
    ]);
    const reduced = emulateReducedMotion(compiled.css);
    try {
      render(
        <>
          <Checkbox aria-label="Accept" />
          <Badge>Badge</Badge>
          <Switch aria-label="Switch" />
          <Popover open>
            <PopoverTrigger>Open</PopoverTrigger>
            <PopoverPopup>Popover body</PopoverPopup>
          </Popover>
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger>Hover</TooltipTrigger>
              <TooltipContent>Tooltip body</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </>,
      );
      for (const element of [
        screen.getByRole("checkbox"),
        screen.getByText("Badge"),
        screen.getByRole("switch"),
        ...[
          "popover-positioner",
          "popover-popup",
          "tooltip-positioner",
          "tooltip-popup",
        ].map((slot) => document.querySelector(`[data-slot="${slot}"]`)),
      ]) {
        expect(element).not.toBeNull();
        expect(getComputedStyle(element as Element).transitionDuration).toMatch(
          /^0(?:s|ms)$/,
        );
      }
      expect(
        getComputedStyle(
          document.querySelector('[data-slot="switch-thumb"]') as Element,
        ).transition,
      ).toBe("none");
    } finally {
      reduced.remove();
      compiled.cleanup();
    }
  });

  it("makes the menu checkbox thumb static under reduced motion", async () => {
    const compiled = await mountCompiledMotionStyles(["duration-fast"]);
    const reduced = emulateReducedMotion(compiled.css);
    try {
      render(
        <Menu defaultOpen>
          <MenuTrigger>Menu</MenuTrigger>
          <MenuPopup>
            <MenuCheckboxItem checked variant="switch">
              Option
            </MenuCheckboxItem>
          </MenuPopup>
        </Menu>,
      );
      await screen.findByText("Option");
      const thumb = document.querySelector('[data-slot="menu-checkbox-thumb"]');
      expect(thumb).not.toBeNull();
      expect(thumb?.className).toContain(
        "scale_var(--duration-fast)_var(--ease-out)_var(--duration-fast)",
      );
      expect(getComputedStyle(thumb as Element).transition).toBe("none");
      expect(getComputedStyle(thumb as Element).scale).toBe("none");
    } finally {
      reduced.remove();
      compiled.cleanup();
    }
  });

  it("removes scale transitions from interactive tabs and cards under reduced motion", async () => {
    const compiled = await mountCompiledMotionStyles([
      "press-feedback",
      "transition-[color,background-color,box-shadow,scale]",
    ]);
    const reduced = emulateReducedMotion(compiled.css);
    try {
      render(
        <>
          <Card interactive>Card</Card>
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTab value="one">One</TabsTab>
            </TabsList>
          </Tabs>
        </>,
      );
      const card = screen.getByText("Card");
      const tab = screen.getByRole("tab", { name: "One" });
      expect(getComputedStyle(card).transitionProperty).toBe("none");
      expect(getComputedStyle(tab).transitionProperty).toBe("none");
    } finally {
      reduced.remove();
      compiled.cleanup();
    }
  });

  it("renders a lazy toast with token transitions and no reduced-motion transition", async () => {
    const compiled = await mountCompiledMotionStyles([
      "transition-opacity",
      "duration-base",
    ]);
    const reduced = emulateReducedMotion(compiled.css);
    try {
      render(<ToastProvider />);
      act(() => {
        toastManager.add({ title: "Saved motion" });
      });
      const title = await screen.findByText("Saved motion");
      const toast = title.closest('[data-slot="toast-popup"]');
      expect(toast).not.toBeNull();
      expect(toast?.className).toContain(
        "transform_var(--duration-base)_var(--ease-out)",
      );
      expect(toast?.className).toContain(
        "height_var(--duration-fast)_var(--ease-out)",
      );
      expect(getComputedStyle(toast as Element).transition).toBe("none");
    } finally {
      toastManager.close();
      reduced.remove();
      compiled.cleanup();
    }
  });

  it("stops spinner, skeleton and transition utilities while keeping the status named", async () => {
    const compiled = await mountCompiledMotionStyles([
      "animate-spin",
      "animate-skeleton",
      "animate-pulse",
      "transition-[height]",
      "transition-[scale,opacity,translate]",
      "scroll-smooth",
      "transition-opacity",
      "transition-transform",
      "duration-base",
    ]);
    const reduced = emulateReducedMotion(compiled.css);
    try {
      render(
        <>
          <Spinner />
          <Skeleton data-testid="skeleton" />
          <div data-testid="pulse" className="animate-pulse" />
          <div
            data-testid="height"
            className="transition-[height] duration-base"
          />
          <div
            data-testid="scale"
            className="transition-[scale,opacity,translate] duration-base"
          />
          <div data-testid="scroll" className="scroll-smooth" />
          <div
            data-testid="motion"
            className="transition-transform duration-base"
          />
        </>,
      );
      const spinner = screen.getByRole("status", { name: "Loading" });
      const skeleton = screen.getByTestId("skeleton");
      expect(getComputedStyle(spinner).animation).toBe("none");
      expect(getComputedStyle(skeleton).animation).toBe("none");
      expect(getComputedStyle(screen.getByTestId("pulse")).animation).toBe(
        "none",
      );
      for (const name of ["height", "scale"])
        expect(
          getComputedStyle(screen.getByTestId(name)).transitionDuration,
        ).toMatch(/^0(?:s|ms)$/);
      expect(
        getComputedStyle(screen.getByTestId("scroll")).scrollBehavior,
      ).toBe("auto");
      expect(
        getComputedStyle(skeleton)
          .getPropertyValue("--skeleton-highlight")
          .trim(),
      ).toBe("transparent");
      expect(
        getComputedStyle(screen.getByTestId("motion")).transitionDuration,
      ).toMatch(/^0(?:s|ms)$/);
    } finally {
      reduced.remove();
      compiled.cleanup();
    }
  });
});
