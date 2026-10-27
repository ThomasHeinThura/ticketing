import { describe, expect, it } from "vitest";
import {
  createCsvAdapter,
  genericCsvProfile,
  inspectCsvConnection,
} from "../../../../apps/api/src/imports/adapters/csv";
import { parseDate } from "../../../../apps/api/src/imports/adapters/csv/core";
import {
  CSV_LIMITS,
  parseCsv,
} from "../../../../apps/api/src/imports/adapters/csv/parse";
import type { SourceRecord } from "../../../../apps/api/src/imports/engine/adapter";
import { connection, context, fixture, readAll } from "./helpers";

describe("csv parser (RFC 4180)", () => {
  it("parses quoted fields, escaped quotes, embedded delimiters and newlines", () => {
    const result = parseCsv(
      'a,b,c\r\n1,"he said ""hi"", ok","line1\nline2"\r\n2,,x\r\n',
    );
    expect(result.fatal).toBeNull();
    expect(result.header).toEqual(["a", "b", "c"]);
    expect(result.rows.map((r) => r.cells)).toEqual([
      ["1", 'he said "hi", ok', "line1\nline2"],
      ["2", "", "x"],
    ]);
    expect(result.rows[1]?.line).toBe(4);
  });

  it("accepts LF and bare CR separators and a missing final newline", () => {
    expect(parseCsv("a,b\n1,2\n3,4").rows).toHaveLength(2);
    expect(parseCsv("a,b\r1,2\r3,4").rows).toHaveLength(2);
    expect(parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n").rows).toHaveLength(2);
  });

  it("strips a UTF-8 BOM from the first header", () => {
    expect(parseCsv("﻿id,title\n1,x").header).toEqual(["id", "title"]);
  });

  it("supports comma, semicolon and tab delimiters and detects them", () => {
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
    expect(parseCsv('a,b\n"1;2",3').delimiter).toBe(",");
    const forced = parseCsv("a;b,c\n1;2,3", { delimiter: ";" });
    expect(forced.header).toEqual(["a", "b,c"]);
  });

  it("keeps unicode intact", () => {
    const row = parseCsv("t\n日本語 ✅ café").rows[0];
    expect(row?.cells[0]).toBe("日本語 ✅ café");
  });

  it("pads or cuts ragged rows and says so", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n1,2,3,4");
    expect(rows[0]).toMatchObject({
      cells: ["1", "2", ""],
      issues: ["row_column_count_mismatch"],
    });
    expect(rows[1]).toMatchObject({
      cells: ["1", "2", "3"],
      issues: ["row_column_count_mismatch"],
    });
  });

  it("flags stray quotes and truncated fields instead of coercing silently", () => {
    expect(parseCsv('a\nab"c').rows[0]).toMatchObject({
      cells: ['ab"c'],
      issues: ["stray_quote"],
    });
    const long = parseCsv(`a\n${"x".repeat(50)}`, { maxFieldLength: 10 });
    expect(long.rows[0]?.cells[0]).toHaveLength(10);
    expect(long.rows[0]?.issues).toContain("field_truncated");
  });

  it("refuses files with a clear fatal code", () => {
    expect(parseCsv("a,b\n1,2", { maxBytes: 3 }).fatal).toBe("file_too_large");
    expect(parseCsv("   \n").fatal).toBe("empty_file");
    expect(parseCsv('a\n"open').fatal).toBe("unterminated_quote");
    expect(parseCsv("a\n1\n2\n3", { maxRows: 2 }).fatal).toBe("too_many_rows");
    expect(parseCsv("a,b,c\n1,2,3", { maxColumns: 2 }).fatal).toBe(
      "too_many_columns",
    );
    expect(CSV_LIMITS.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("enforces the row and column limits while parsing, not after the whole file is read", () => {
    // 5 MiB of one-character rows is exactly at the byte limit: the row limit must trip.
    const started = Date.now();
    const bomb = parseCsv("a\n".repeat(CSV_LIMITS.maxBytes / 2));
    expect(bomb).toMatchObject({ fatal: "too_many_rows", rows: [] });
    expect(Date.now() - started).toBeLessThan(2000);
    // Proof the parse stopped early: a stray quote after the limit is never reached, so the
    // answer is the row limit and not `unterminated_quote` (which needs the whole file).
    expect(
      parseCsv(`a\n${"1\n".repeat(CSV_LIMITS.maxRows + 1)}"open`).fatal,
    ).toBe("too_many_rows");
    // A header line of countless cells stops at the column limit, not after building them all.
    expect(parseCsv(`${",".repeat(CSV_LIMITS.maxBytes - 10)}\n1`).fatal).toBe(
      "too_many_columns",
    );
    // Exactly at the limit is still accepted.
    expect(parseCsv("a\n1\n2", { maxRows: 2 }).fatal).toBeNull();
    expect(parseCsv("a,b\n1,2", { maxColumns: 2 }).fatal).toBeNull();
  });

  it("measures the size limit in UTF-8 bytes, not characters", () => {
    // 3 characters but 9 bytes
    expect(parseCsv("a\n日本語", { maxBytes: 8 }).fatal).toBe("file_too_large");
  });

  it("records duplicate headers", () => {
    expect(parseCsv("a,a,b\n1,2,3").duplicateHeaders).toEqual(["a"]);
  });
});

describe("csv dates", () => {
  it("accepts real ISO dates only and rejects overflow days", () => {
    expect(parseDate("2026-03-01", "iso")).toBe("2026-03-01T00:00:00.000Z");
    expect(parseDate("2026-03-01T09:30:00Z", "iso")).toBe(
      "2026-03-01T09:30:00.000Z",
    );
    expect(parseDate("2026-03-01T09:30:00+02:00", "iso")).toBe(
      "2026-03-01T07:30:00.000Z",
    );
    expect(parseDate("2026-02-30", "iso")).toBeNull();
    expect(parseDate("31/02/2026", "iso")).toBeNull();
    expect(parseDate("tomorrow", "iso")).toBeNull();
  });
  it("reads month/day or day/month only when asked", () => {
    expect(parseDate("3/14/2026", "mdy")).toBe("2026-03-14T00:00:00.000Z");
    expect(parseDate("14/3/2026", "dmy")).toBe("2026-03-14T00:00:00.000Z");
    expect(parseDate("13/45/2026", "mdy")).toBeNull();
    expect(parseDate("3/14/2026 2:30 PM", "mdy")).toBe(
      "2026-03-14T14:30:00.000Z",
    );
  });
});

describe("generic csv adapter", () => {
  const adapter = createCsvAdapter();
  const conn = (extra: Record<string, unknown> = {}) =>
    connection("import.csv", { csvText: fixture("csv/issues.csv"), ...extra });
  const lossCodes = (r: SourceRecord) => (r.losses ?? []).map((l) => l.code);

  it("connects, refuses unusable files, and never needs a credential", async () => {
    expect(await adapter.connect(conn())).toEqual({ ok: true });
    expect(await adapter.connect(connection("import.csv", {}))).toMatchObject({
      ok: false,
    });
    expect(
      await adapter.connect(connection("import.csv", { csvText: "a,b\n1,2" })),
    ).toMatchObject({ ok: false }); // no title column
    await expect(
      adapter.discover(connection("import.csv", { csvText: "" })),
    ).rejects.toThrow();
  });

  it("discovers facets with counts for every mapped column", async () => {
    const d = await adapter.discover(conn());
    const count = (domain: string, value: string) =>
      d.facets.find((f) => f.domain === domain && f.value === value)?.count;
    expect(d.totalRecords).toBe(67);
    expect(count("state", "Todo")).toBeGreaterThan(10);
    expect(count("state", "Waiting for vendor")).toBe(1);
    expect(count("type", "Bug")).toBeGreaterThan(10);
    expect(count("priority", "Urgent")).toBeGreaterThan(5);
    expect(count("label", "platform")).toBeGreaterThan(10);
    expect(count("project", "HELP")).toBeGreaterThan(50);
    expect(count("custom_field", "customer")).toBeGreaterThan(5);
    expect(count("person", "ana.lopez@example.test")).toBeGreaterThan(5);
    expect(count("person", "not-an-email@")).toBeUndefined();
  });

  it("inspects columns, samples and value sets for the wizard", () => {
    const view = inspectCsvConnection(conn(), genericCsvProfile);
    if ("fatal" in view) throw new Error("fatal");
    expect(view.delimiter).toBe(",");
    expect(view.rowCount).toBe(67);
    expect(view.ignoredColumns).toEqual(["Sprint Notes"]);
    const state = view.columns.find((c) => c.header === "state");
    expect(state?.field).toBe("state");
    expect(state?.sample).toHaveLength(5);
    expect(view.columns.find((c) => c.header === "cf_customer")?.field).toBe(
      "custom_field",
    );
    expect(view.valueSets.state?.some((v) => v.value === "Todo")).toBe(true);
    expect(view.issues.invalid_date).toBeGreaterThanOrEqual(2);
  });

  it("proposes state, priority, type, person and project values (unconfirmed heuristics)", async () => {
    const d = await adapter.discover(conn());
    const proposals = await adapter.proposeMapping(d, context);
    const find = (domain: string, value: string) =>
      proposals.find((p) => p.domain === domain && p.value === value);
    expect(find("state", "Backlog")?.target).toEqual({
      kind: "group",
      group: "backlog",
    });
    expect(find("state", "In Progress")?.target).toEqual({
      kind: "group",
      group: "started",
    });
    expect(find("state", "Won't do")?.target).toEqual({
      kind: "group",
      group: "cancelled",
    });
    expect(find("state", "Waiting for vendor")).toBeUndefined();
    expect(find("priority", "Urgent")?.target).toEqual({
      kind: "priority",
      value: "urgent",
    });
    expect(find("priority", "Whenever")).toBeUndefined();
    expect(find("type", "Task")).toMatchObject({
      target: { kind: "target", id: "type-task" },
      confidence: "heuristic",
    });
    expect(find("type", "Bug")).toBeUndefined();
    expect(find("person", "ana.lopez@example.test")).toMatchObject({
      target: { kind: "target", id: "person-ana" },
      confidence: "exact",
    });
    expect(find("person", "ben.okafor@example.test")?.target).toEqual({
      kind: "placeholder",
    });
    expect(find("project", "HELP")?.target).toEqual({ kind: "ignore" });
    expect(proposals.every((p) => p.confidence !== undefined)).toBe(true);
  });

  it("pages deterministically with an opaque row cursor", async () => {
    const first = await adapter.readPage(conn(), null, 25);
    expect(first.records).toHaveLength(25);
    expect(first.nextCursor).toBe("25");
    const again = await adapter.readPage(conn(), null, 25);
    expect(again).toEqual(first);
    const last = await adapter.readPage(conn(), "50", 25);
    expect(last.records).toHaveLength(17);
    expect(last.nextCursor).toBeNull();
    const all = await readAll(adapter, conn(), 7);
    expect(all.map((r) => r.sourceId)).toEqual(
      (await readAll(adapter, conn(), 500)).map((r) => r.sourceId),
    );
    await expect(adapter.readPage(conn(), "nope", 10)).rejects.toThrow();
  });

  it("builds stable ids and hashes; the same file always yields the same records", async () => {
    const a = await readAll(adapter, conn());
    const b = await readAll(adapter, conn());
    expect(a).toEqual(b);
    const ids = a.map((r) => r.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.find((r) => r.sourceId === "T-001")?.sourceHash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    const hashed = a.filter((r) => r.sourceId.startsWith("row-"));
    expect(hashed).toHaveLength(2);
    expect(hashed[1]?.sourceId.endsWith("~2")).toBe(true);
    expect(lossCodes(hashed[0] as SourceRecord)).toContain(
      "external_id_missing",
    );
  });

  it("reports every invalid row as a loss; nothing is silently coerced", async () => {
    const records = await readAll(adapter, conn());
    const by = (id: string) => records.find((r) => r.sourceId === id);
    // bad created_at: reported, not defaulted
    expect(by("T-010")?.sourceCreatedAt).toBeUndefined();
    expect(by("T-010")?.losses).toContainEqual({
      code: "invalid_date",
      detailCode: "created_at",
    });
    expect(by("T-011")?.dueDate).toBeUndefined();
    expect(by("T-011")?.losses).toContainEqual({
      code: "invalid_date",
      detailCode: "due_date",
    });
    expect(by("T-015")?.assigneeEmail).toBeUndefined();
    expect(by("T-015")?.losses).toContainEqual({
      code: "invalid_email",
      detailCode: "assignee",
    });
    expect(lossCodes(by("T-016") as SourceRecord)).toContain(
      "parent_not_found",
    );
    expect(by("T-016")?.parentSourceId).toBeUndefined();
    expect(by("T-017")?.parentSourceId).toBe("T-003");
    expect(lossCodes(by("T-018") as SourceRecord)).toContain(
      "parent_self_reference",
    );
    // duplicate id: kept out of the first row, empty title so the engine rejects it
    const dup = records.find((r) => r.sourceId === "T-004~dup2");
    expect(dup).toMatchObject({ title: "" });
    expect(lossCodes(dup as SourceRecord)).toContain("duplicate_source_id");
    expect(by("T-004")?.title).toBe("Imported item 4");
    // empty title / state / type rows keep their gaps (engine rejects them)
    expect(lossCodes(by("T-061") as SourceRecord)).toContain("title_missing");
    expect(by("T-062")?.facets.some((f) => f.domain === "state")).toBe(false);
    expect(by("T-063")?.facets.some((f) => f.domain === "type")).toBe(false);
    // ragged row
    expect(lossCodes(by("T-064") as SourceRecord)).toContain(
      "row_column_count_mismatch",
    );
    // unknown columns and custom fields are reported
    expect(by("T-013")?.losses).toContainEqual({
      code: "column_ignored",
      detailCode: "sprint_notes",
    });
    expect(by("T-007")?.customFields?.length).toBeGreaterThan(0);
    expect(lossCodes(by("T-007") as SourceRecord)).not.toContain(
      "custom_field_value_not_carried",
    );
    expect(dup).toMatchObject({ rejectCode: "duplicate_source_id" });
  });

  it("keeps quotes, newlines and unicode in titles and descriptions", async () => {
    const records = await readAll(adapter, conn());
    const by = (id: string) => records.find((r) => r.sourceId === id);
    expect(by("T-005")?.title).toBe('Fix "login" bug, again');
    expect(by("T-006")?.description).toBe(
      'Line one\nLine two with, comma\n"quoted" line three',
    );
    expect(by("T-007")?.title).toBe("Überprüfung der Zahlungs-API 日本語 ✅");
    expect(by("T-007")?.description).toBe("Ünïcödé café – naïve résumé");
  });

  it("honours delimiter, id column and column map configuration", async () => {
    const semicolon = await readAll(
      adapter,
      connection("import.csv", {
        csvText: fixture("csv/issues-semicolon.csv"),
      }),
    );
    expect(semicolon.map((r) => r.title)).toContain("Semicolon; item 2");
    const tab = await readAll(
      adapter,
      connection("import.csv", {
        csvText: fixture("csv/issues-tab.csv"),
        delimiter: "tab",
      }),
    );
    expect(tab).toHaveLength(3);
    const mapped = await readAll(
      adapter,
      connection("import.csv", {
        csvText: "Ticket,Summary,Status\nA1,Hello,Open\nA2,World,Done",
        columnMap: { title: "Summary", state: "Status" },
        idColumn: "Ticket",
        defaultType: "Bug",
      }),
    );
    expect(mapped).toMatchObject([
      { sourceId: "A1", title: "Hello" },
      { sourceId: "A2", title: "World" },
    ]);
    expect(mapped[0]?.facets).toContainEqual({ domain: "type", value: "Bug" });
    expect(mapped[0]?.facets).toContainEqual({
      domain: "state",
      value: "Open",
    });
  });
});
