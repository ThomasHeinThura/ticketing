import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import WorkItemListControls from "./work-item-list-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

afterEach(cleanup);

const noop = () => {};

describe("work list filter controls", () => {
  it("loads the editor and labels a refused filter with the server's status and detail", async () => {
    render(
      <WorkItemListControls
        filter="label:urgent"
        mode="text"
        workItemsError={new HttpError(422, "Filter field unavailable: label")}
        onModeChange={noop}
        onApply={noop}
      />,
    );
    expect(
      await screen.findByTestId("work-item-search-error", undefined, {
        timeout: 5000,
      }),
    ).toHaveTextContent("422: Filter field unavailable: label");
  });

  it("does not show an unrelated failure (a 500 or a network error) as a filter refusal", async () => {
    render(
      <WorkItemListControls
        filter="priority:high"
        mode="text"
        workItemsError={new HttpError(500, "Failed to search work items")}
        onModeChange={noop}
        onApply={noop}
      />,
    );
    await screen.findByRole("textbox", { name: "Filter work items" });
    expect(screen.queryByTestId("work-item-search-error")).toBeNull();
  });

  it("F3 hold: renders no export control and the web app has no export or download fetcher", async () => {
    render(
      <WorkItemListControls
        filter=""
        mode="visual"
        onModeChange={noop}
        onApply={noop}
      />,
    );
    await screen.findByRole("form", { name: "Work item filters" });
    expect(
      screen.queryByRole("button", { name: /export|download/i }),
    ).toBeNull();

    const fetchers = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../fetchers/work-item",
    );
    expect(
      readdirSync(fetchers).filter((name) => /export|download/i.test(name)),
    ).toEqual([]);
  });
});
