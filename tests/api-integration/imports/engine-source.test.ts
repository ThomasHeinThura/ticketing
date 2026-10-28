import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../apps/api/src/index";
import { resetTestDatabase } from "../helpers/database";
import { call, engineFixture, post, req } from "./engine-helpers";

beforeEach(async () => resetTestDatabase());

const csvOf = (targetBytes: number) => {
  const rows = ["external_id,title,description"];
  let size = rows[0]?.length ?? 0;
  for (let i = 1; size < targetBytes; i += 1) {
    const row = `${i},"Title with ""quotes"" ${i}","line one\nline two, ""q"" ${"p".repeat(70)}"`;
    rows.push(row);
    size += row.length + 1;
  }
  return rows.join("\n");
};

describe("import source connections", () => {
  it("accepts a CSV near the documented 5 MiB inline size, with quotes and newlines, and never echoes it back", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const csvText = csvOf(5 * 1024 * 1024 - 4096);
    expect(Buffer.byteLength(csvText)).toBeLessThanOrEqual(5 * 1024 * 1024);
    const body = JSON.stringify({
      workspaceId: f.workspace.id,
      pluginId: "import.csv",
      name: "big.csv",
      config: { csvText },
    });
    // JSON escaping inflates the body well past the file size; it must still be accepted.
    expect(Buffer.byteLength(body)).toBeGreaterThan(Buffer.byteLength(csvText));
    const created = await req(app, f.key, "/api/import-sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body,
    });
    expect(created.status, (await created.clone().text()).slice(0, 200)).toBe(
      200,
    );
    const source = await created.json();
    expect(source.config.csvText).toBeUndefined();
    expect(source.inline.csvText.bytes).toBe(Buffer.byteLength(csvText));
    const listed = await call(
      app,
      f.key,
      `/api/import-sources?workspaceId=${f.workspace.id}`,
      undefined,
      200,
    );
    expect(JSON.stringify(listed)).not.toContain("Title with");
    expect(listed.sources[0].inline.csvText.bytes).toBe(
      Buffer.byteLength(csvText),
    );
  });

  it("refuses an oversize body with 413 on this route only", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const response = await req(app, f.key, "/api/import-sources", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        workspaceId: f.workspace.id,
        pluginId: "import.csv",
        name: "huge.csv",
        config: { csvText: "a".repeat(21 * 1024 * 1024) },
      }),
    });
    expect(response.status).toBe(413);
  });

  it("reports a fixed reason code when the source cannot be connected", async () => {
    const f = await engineFixture();
    const { app } = createApp();
    const create = (pluginId: string, name: string, config: unknown) =>
      req(
        app,
        f.key,
        "/api/import-sources",
        post({ workspaceId: f.workspace.id, pluginId, name, config }),
      );
    const tooLarge = await create("import.csv", "large", {
      csvText: `external_id,title\n${"x".repeat(5 * 1024 * 1024 + 10)}`,
    });
    expect(tooLarge.status).toBe(502);
    expect(await tooLarge.json()).toMatchObject({ reason: "file_too_large" });
    const noTitle = await create("import.csv", "notitle", {
      csvText: "external_id,state\n1,Open",
    });
    expect(await noTitle.json()).toMatchObject({
      reason: "missing_required_column",
    });
    const badExport = await create("import.jira", "badexport", {
      mode: "export",
      exportText: "{not json",
    });
    expect(await badExport.json()).toMatchObject({ reason: "invalid_export" });
    const goodExport = await create("import.jira", "goodexport", {
      mode: "export",
      exportText: JSON.stringify({ issues: [] }),
    });
    expect(goodExport.status).toBe(200);
  });
});
