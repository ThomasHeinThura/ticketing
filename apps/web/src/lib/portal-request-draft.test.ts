import type { FormSchema } from "@taskdesk/domain/intake";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPortalRequestDraft,
  portalRequestDraftStorageKey,
  readPortalRequestDraft,
  writePortalRequestDraft,
} from "./portal-request-draft";

const schema: FormSchema = {
  fields: [
    { key: "summary", type: "text", label: "Summary", required: true },
    {
      key: "impact",
      type: "select",
      label: "Impact",
      options: ["me", "team"],
    },
    { key: "notify", type: "checkbox", label: "Notify" },
    { key: "proof", type: "file", label: "Proof" },
  ],
};

describe("RT-16: portal request drafts", () => {
  beforeEach(() => window.localStorage.clear());

  it("keys drafts by immutable request-type key and version", () => {
    expect(portalRequestDraftStorageKey("request/key", 2)).not.toBe(
      portalRequestDraftStorageKey("request/key", 3),
    );
    expect(portalRequestDraftStorageKey("request/key", 2)).toContain(
      "request%2Fkey",
    );
  });

  it("restores known typed answers but never persists file values or unknown fields", () => {
    const storageKey = portalRequestDraftStorageKey("request-key", 1);
    writePortalRequestDraft(window.localStorage, storageKey, schema, {
      summary: "Blocked",
      impact: "team",
      notify: true,
      proof: "attachment-id",
      removedField: "ignored",
    });

    expect(
      readPortalRequestDraft(window.localStorage, storageKey, schema),
    ).toEqual({
      summary: "Blocked",
      impact: "team",
      notify: true,
    });
  });

  it("drops corrupt or incompatible local data without failing the form", () => {
    const storageKey = portalRequestDraftStorageKey("request-key", 1);
    window.localStorage.setItem(storageKey, "not-json{");

    expect(
      readPortalRequestDraft(window.localStorage, storageKey, schema),
    ).toEqual({});
    expect(window.localStorage.getItem(storageKey)).toBeNull();

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ summary: 42, proof: ["not persisted"] }),
    );
    expect(
      readPortalRequestDraft(window.localStorage, storageKey, schema),
    ).toEqual({});
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("clears the matching draft after successful submission", () => {
    const storageKey = portalRequestDraftStorageKey("request-key", 1);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ summary: "Done" }),
    );

    clearPortalRequestDraft(window.localStorage, storageKey);

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });
});
