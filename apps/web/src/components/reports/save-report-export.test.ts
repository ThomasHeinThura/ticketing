import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const download = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/report", () => ({ downloadReportExport: download }));

import { saveReportExport } from "./report-export";
import { chunkedResponse, fakeFile } from "./test-writable";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function pick(failWriteAt?: number) {
  const file = fakeFile(failWriteAt);
  const picker = vi.fn(async () => ({
    createWritable: async () => file.writable,
  }));
  vi.stubGlobal("showSaveFilePicker", picker);
  return { file, picker };
}

const chunks = chunkedResponse;

describe("saveReportExport (RP-10)", () => {
  it("opens the picker before the request and streams without calling blob()", async () => {
    const { file, picker } = pick();
    const response = chunks(["a,b\n", "1,2\n"]);
    const blob = vi.spyOn(response, "blob");
    download.mockImplementation(async () => {
      expect(picker).toHaveBeenCalledTimes(1);
      return { filename: "e.csv", response };
    });
    await saveReportExport("e1");
    expect(file.bytes.join("")).toBe("a,b\n1,2\n");
    expect(file.closed).toBe(true);
    expect(file.aborted).toBe(false);
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
      const { file } = pick();
      download.mockRejectedValue(new HttpError(status, "refused"));
      await expect(saveReportExport("e1")).rejects.toMatchObject({ status });
      expect(file.aborted).toBe(true);
      expect(file.closed).toBe(false);
      expect(file.bytes).toEqual([]);
    },
  );

  it("aborts the file on a network error after some bytes were written", async () => {
    const { file } = pick();
    download.mockResolvedValue({
      filename: "e.csv",
      response: chunks(["a,b\n"], true),
    });
    await expect(saveReportExport("e1")).rejects.toThrow("network error");
    // Bytes arrived, yet the destination is discarded, never closed as a short file.
    expect(file.bytes).toEqual(["a,b\n"]);
    expect(file.aborted).toBe(true);
    expect(file.closed).toBe(false);
  });

  it("aborts the file on a disk-write error after some bytes were written", async () => {
    const { file } = pick(1);
    download.mockResolvedValue({
      filename: "e.csv",
      response: chunks(["a,b\n", "1,2\n", "3,4\n"]),
    });
    await expect(saveReportExport("e1")).rejects.toThrow("disk full");
    expect(file.bytes).toEqual(["a,b\n"]);
    expect(file.aborted).toBe(true);
    expect(file.closed).toBe(false);
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
