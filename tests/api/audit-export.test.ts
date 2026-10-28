import { describe, expect, it } from "vitest";
import { activityValueToString } from "../../apps/api/src/audit/activity-value";
import {
  AUDIT_EXPORT_COLUMNS,
  auditRowsToCsv,
  auditRowsToJson,
  csvField,
} from "../../apps/api/src/audit/export";
import type { AuditRowResponse } from "../../apps/api/src/audit/response";

const row = (over: Partial<AuditRowResponse> = {}): AuditRowResponse => ({
  id: "a1",
  seq: "7",
  createdAt: "2026-10-01T00:00:00.000Z",
  actorId: "u1",
  actorType: "person",
  impersonatorId: null,
  workspaceId: "w1",
  organisationId: null,
  action: "work_item.archived",
  entityType: "work_item",
  entityId: "wi1",
  before: null,
  after: { archived: true },
  ...over,
});

describe("audit export documents (AU-13)", () => {
  it("writes one stable header and CRLF-terminated rows", () => {
    const csv = auditRowsToCsv([row()]);
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(AUDIT_EXPORT_COLUMNS.join(","));
    expect(line).toContain('"{""archived"":true}"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes delimiters and neutralises spreadsheet formulas", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@x")).toBe("'@x");
    expect(csvField(null)).toBe("");
  });

  it("emits an empty body of rows for no matches and valid JSON otherwise", () => {
    expect(auditRowsToCsv([])).toBe(`${AUDIT_EXPORT_COLUMNS.join(",")}\r\n`);
    expect(JSON.parse(auditRowsToJson([row()]))).toEqual({ rows: [row()] });
  });
});

describe("activity values folded by reconstruction", () => {
  it("keeps strings and null and serialises everything else", () => {
    expect(activityValueToString("High")).toBe("High");
    expect(activityValueToString(null)).toBeNull();
    expect(activityValueToString(undefined)).toBeNull();
    expect(activityValueToString(3)).toBe("3");
    expect(activityValueToString({ a: 1 })).toBe('{"a":1}');
  });
});
