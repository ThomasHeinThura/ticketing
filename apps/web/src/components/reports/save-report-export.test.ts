import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const download = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/report", () => ({
  downloadReportExport: download,
  getReportExport: status,
  reportExportDownloadUrl: (id: string) => `/api/report-exports/${id}/download`,
}));

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

  describe("without the picker (Firefox, Safari)", () => {
    function spyClicks() {
      const links: { href: string; name: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          links.push({
            href: this.getAttribute("href") ?? "",
            name: this.download,
          });
        },
      );
      return links;
    }

    it("hands the authenticated URL to the browser, with no fetch of the body and no Blob", async () => {
      vi.stubGlobal("showSaveFilePicker", undefined);
      const createObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL;
      status.mockResolvedValue({ data: { status: "ready" } });
      const links = spyClicks();
      await saveReportExport("e1");
      expect(links).toEqual([
        { href: "/api/report-exports/e1/download", name: "" },
      ]);
      expect(download).not.toHaveBeenCalled();
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it.each([
      ["expired", 410],
      ["failed", 409],
      ["running", 409],
    ])(
      "keeps a %s export an in-app %s error and starts no download",
      async (value, code) => {
        vi.stubGlobal("showSaveFilePicker", undefined);
        status.mockResolvedValue({ data: { status: value } });
        const links = spyClicks();
        await expect(saveReportExport("e1")).rejects.toMatchObject({
          status: code,
        });
        expect(links).toEqual([]);
      },
    );

    it("keeps a refused status read an in-app error", async () => {
      vi.stubGlobal("showSaveFilePicker", undefined);
      status.mockRejectedValue(new HttpError(403, "forbidden"));
      const links = spyClicks();
      await expect(saveReportExport("e1")).rejects.toMatchObject({
        status: 403,
      });
      expect(links).toEqual([]);
    });
  });
});
