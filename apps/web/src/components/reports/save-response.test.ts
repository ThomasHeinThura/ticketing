import { afterEach, describe, expect, it, vi } from "vitest";
import { saveResponse } from "./report-export";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("saveResponse (RP-10)", () => {
  it("pipes the body to the picked file under the same name without calling blob()", async () => {
    const written: string[] = [];
    const picker = vi.fn(async () => ({
      createWritable: async () =>
        new WritableStream<Uint8Array>({
          write: (chunk) => void written.push(new TextDecoder().decode(chunk)),
        }),
    }));
    vi.stubGlobal("showSaveFilePicker", picker);
    const response = new Response("a,b\n");
    const blob = vi.spyOn(response, "blob");
    await saveResponse("e-1.csv", response);
    expect(picker).toHaveBeenCalledWith({ suggestedName: "e-1.csv" });
    expect(written.join("")).toBe("a,b\n");
    expect(blob).not.toHaveBeenCalled();
  });

  it("stops the transfer when the person cancels the picker", async () => {
    vi.stubGlobal(
      "showSaveFilePicker",
      vi.fn(async () => {
        throw new DOMException("cancelled", "AbortError");
      }),
    );
    const response = new Response("a");
    const blob = vi.spyOn(response, "blob");
    await saveResponse("e.csv", response);
    expect(blob).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("falls back to a Blob download with the same filename without the picker", async () => {
    vi.stubGlobal("showSaveFilePicker", undefined);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    await saveResponse("e-2.csv", new Response("a"));
    expect(names).toEqual(["e-2.csv"]);
  });
});
