vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));
const mocks = vi.hoisted(() => ({ retry: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/fetchers/attachment/work-item-upload-queue", () => ({
  retryWorkItemUpload: mocks.retry,
  dismissWorkItemUpload: mocks.dismiss,
  getWorkItemUploads: () => [],
  subscribeWorkItemUploads: () => () => undefined,
}));

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemUpload } from "@/fetchers/attachment/work-item-upload-queue";
import { WorkItemUploadList } from "./work-item-attachments-uploads";

const base = {
  itemKey: "OPS-1",
  state: "uploading",
  loaded: 0,
} as const;
function upload(value: Partial<WorkItemUpload> & { id: number; name: string }) {
  const { name, ...rest } = value;
  return { ...base, file: new File(["abcd"], name), ...rest } as WorkItemUpload;
}

afterEach(cleanup);

describe("AT-12 per-file progress and failure", () => {
  it("renders one row per file, each with its own progress bar", () => {
    render(
      <WorkItemUploadList
        uploads={[
          upload({ id: 1, name: "half.png", loaded: 2 }),
          upload({ id: 2, name: "queued.png", state: "queued" }),
        ]}
      />,
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "50");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("half.png")).toBeInTheDocument();
  });

  it("shows exactly why a file failed (AT-14) and lets that file retry or be dismissed on its own", () => {
    render(
      <WorkItemUploadList
        uploads={[
          upload({
            id: 7,
            name: "big.zip",
            state: "failed",
            reason: "This file is 41 MB; the limit is 25 MB.",
          }),
          upload({ id: 8, name: "ok.png", loaded: 1 }),
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This file is 41 MB; the limit is 25 MB.",
    );
    // The healthy file keeps its bar; only the failed one offers retry.
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:detail.attachments.retryUpload:big.zip",
      }),
    );
    expect(mocks.retry).toHaveBeenCalledWith(7);
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:detail.attachments.dismissUpload:big.zip",
      }),
    );
    expect(mocks.dismiss).toHaveBeenCalledWith(7);
  });

  it("falls back to a generic message only when the server gave no reason", () => {
    render(
      <WorkItemUploadList
        uploads={[upload({ id: 1, name: "x.png", state: "failed" })]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "workItems:detail.attachments.uploadFailed",
    );
  });
});
