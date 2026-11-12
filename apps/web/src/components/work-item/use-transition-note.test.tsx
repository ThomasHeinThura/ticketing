import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { useTransitionNote } from "./use-transition-note";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));

it("queues note prompts for different projects without losing either decision", async () => {
  let hook!: ReturnType<typeof useTransitionNote>;
  function Harness() {
    hook = useTransitionNote("parent");
    return hook.dialog;
  }
  render(<Harness />);
  let first!: Promise<string | null>;
  let second!: Promise<string | null>;
  act(() => {
    first = hook.ask("Done", true);
    second = hook.ask("Closed", true);
  });
  expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
  act(() => screen.getByRole("button", { name: "Cancel" }).click());
  expect(await first).toBeNull();
  expect(screen.getByRole("heading", { name: "Closed" })).toBeInTheDocument();
  act(() => screen.getByRole("button", { name: "Cancel" }).click());
  expect(await second).toBeNull();
});
