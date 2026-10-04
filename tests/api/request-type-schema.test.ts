import { describe, expect, it } from "vitest";
import {
  createRequestTypeBody,
  formSchema,
  submitRequestBody,
  updateRequestTypeBody,
} from "../../apps/api/src/request-type/schema";

describe("request-type transport schemas", () => {
  const validForm = {
    fields: [
      { key: "summary", type: "text", label: "What's wrong?", required: true },
      {
        key: "impact",
        type: "select",
        label: "Impact",
        options: ["one person", "team"],
        mapsTo: {
          field: "priority",
          map: { "one person": "low", team: "medium" },
        },
      },
      {
        key: "asset",
        type: "text",
        label: "Asset",
        showIf: { field_key: "impact", op: "eq", value: "team" },
      },
    ],
  };

  it("RT-3/4/5: accepts the documented form, mapping and visibility shapes", () => {
    expect(formSchema.parse(validForm)).toEqual(validForm);
  });

  it("RT-1/2/7: applies only safe request-type defaults and rejects unknown fields", () => {
    const parsed = createRequestTypeBody.parse({
      workspaceId: "workspace_1",
      name: "Access request",
      group: "Access",
      workItemTypeId: "type_1",
      formSchema: validForm,
    });
    expect(parsed).toMatchObject({
      autoAccept: false,
      customerVisible: false,
      forcePrivate: false,
      position: 0,
    });
    expect(parsed).not.toHaveProperty("slaPolicyId");
    expect(
      createRequestTypeBody.safeParse({
        workspaceId: "workspace_1",
        name: "Access request",
        group: "Access",
        workItemTypeId: "type_1",
        formSchema: validForm,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("RT-6: updates must change at least one declared request-type field", () => {
    expect(updateRequestTypeBody.safeParse({}).success).toBe(false);
    expect(
      updateRequestTypeBody.safeParse({
        formSchema: validForm,
        unknown: true,
      }).success,
    ).toBe(false);
    expect(updateRequestTypeBody.parse({ formSchema: validForm })).toEqual({
      formSchema: validForm,
    });
  });

  it("RT-8a: accepts JSON form data and rejects non-JSON payload values", () => {
    expect(
      submitRequestBody.parse({
        requestTypeKey: "access-request",
        formData: { summary: "Cannot sign in", impact: "team" },
      }).formData,
    ).toEqual({ summary: "Cannot sign in", impact: "team" });
    expect(
      submitRequestBody.safeParse({
        requestTypeKey: "access-request",
        formData: { value: Number.NaN },
      }).success,
    ).toBe(false);
  });
});
