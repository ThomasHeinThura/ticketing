import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch }));

import { downloadReportExport } from "./index";

const stub = (response: Response) => apiFetch.mockResolvedValue(response);

describe("downloadReportExport (RP-10)", () => {
  it("returns the filename and the unread response, never buffering the body", async () => {
    const response = new Response("a,b\n", {
      headers: { "content-disposition": 'attachment; filename="e-1.csv"' },
    });
    const blob = vi.spyOn(response, "blob");
    stub(response);
    const result = await downloadReportExport("e1");
    expect(result.filename).toBe("e-1.csv");
    expect(result.response.bodyUsed).toBe(false);
    expect(blob).not.toHaveBeenCalled();
  });

  it.each([403, 409, 410])("still throws the %s in-app", async (status) => {
    stub(new Response(JSON.stringify({ message: "nope" }), { status }));
    await expect(downloadReportExport("e1")).rejects.toMatchObject({ status });
  });
});
