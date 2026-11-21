import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/report", () => ({ downloadReportExport: download }));

import { saveReportExport } from "./report-export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** A picker whose writable records writes and aborts; `failWriteAt` breaks the disk. */
function pick(failWriteAt?: number) {
  const written: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (written.length === failWriteAt) throw new Error("disk full");
      written.push(new TextDecoder().decode(chunk));
    },
  });
  const abort = vi.spyOn(writable, "abort");
  const picker = vi.fn(async () => ({ createWritable: async () => writable }));
  vi.stubGlobal("showSaveFilePicker", picker);
  return { written, abort, picker };
}

// Errors on the pull after the last chunk, so the written bytes are delivered first.
const chunks = (parts: string[], failAfter = false) => {
  const queue = [...parts];
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const part = queue.shift();
        if (part !== undefined)
          controller.enqueue(new TextEncoder().encode(part));
        else if (failAfter) controller.error(new TypeError("network error"));
        else controller.close();
      },
    }),
  );
};

describe("saveReportExport (RP-10)", () => {
  it("opens the picker before the request and streams without calling blob()", async () => {
    const { written, picker } = pick();
    const response = chunks(["a,b\n", "1,2\n"]);
    const blob = vi.spyOn(response, "blob");
    download.mockImplementation(async () => {
      expect(picker).toHaveBeenCalledTimes(1);
      return { filename: "e.csv", response };
    });
    await saveReportExport("e1");
    expect(written.join("")).toBe("a,b\n1,2\n");
    expect(blob).not.toHaveBeenCalled();
  });

  it("does nothing when the person cancels the picker", async () => {
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () => {
        throw new DOMException("cancelled", "AbortError");
      }),
    );
    await saveReportExport("e1");
    expect(download).not.toHaveBeenCalled();
  });

  it.each([403, 409, 410])(
    "aborts the file and shows the %s when the download is refused",
    async (status) => {
      const { abort } = pick();
      download.mockRejectedValue(new HttpError(status, "refused"));
      await expect(saveReportExport("e1")).rejects.toMatchObject({ status });
      expect(abort).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts the file on a network error after some bytes were written", async () => {
    const { written, abort } = pick();
    download.mockResolvedValue({
      filename: "e.csv",
      response: chunks(["a,b\n"], true),
    });
    await expect(saveReportExport("e1")).rejects.toThrow("network error");
    expect(written.length).toBeGreaterThan(0);
    expect(abort).toHaveBeenCalled();
  });

  it("aborts the file on a disk-write error after some bytes were written", async () => {
    const { written, abort } = pick(1);
    download.mockResolvedValue({
      filename: "e.csv",
      response: chunks(["a,b\n", "1,2\n", "3,4\n"]),
    });
    await expect(saveReportExport("e1")).rejects.toThrow("disk full");
    expect(written).toEqual(["a,b\n"]);
    expect(abort).toHaveBeenCalled();
  });

  it("falls back to a Blob download under the response filename only without the picker", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    download.mockResolvedValue({
      filename: "e-2.csv",
      response: new Response("a"),
    });
    await saveReportExport("e1");
    expect(names).toEqual(["e-2.csv"]);
  });
});
