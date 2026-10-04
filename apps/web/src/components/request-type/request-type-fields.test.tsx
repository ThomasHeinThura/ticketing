import type { FormSchema, FormValue } from "@taskdesk/domain/intake";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTypeFields } from "./request-type-fields";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const schema: FormSchema = {
  fields: [
    { key: "summary", type: "text", label: "Summary", required: true },
    {
      key: "impact",
      type: "select",
      label: "Impact",
      options: ["one person", "team"],
      required: true,
    },
    {
      key: "asset",
      type: "text",
      label: "Asset tag",
      showIf: { field_key: "impact", op: "eq", value: "team" },
    },
  ],
};

function renderFields(
  values: Readonly<Record<string, FormValue>> = {},
  onValueChange = vi.fn(),
) {
  render(
    <RequestTypeFields
      schema={schema}
      values={values}
      requiredLabel="Required"
      selectPlaceholder="Choose an option"
      emptyOptionsLabel="No options found"
      comboTriggerLabel="Toggle options"
      onValueChange={onValueChange}
    />,
  );
  return onValueChange;
}

describe("RequestTypeFields", () => {
  it("RT-5: only renders fields visible for the current answers", () => {
    renderFields();
    expect(screen.getByLabelText("Summary (Required)")).toBeVisible();
    expect(screen.queryByLabelText("Asset tag")).toBeNull();
  });

  it("RT-3/RT-5: renders a conditional field after its controlling answer is present", () => {
    renderFields({ impact: "team" });
    expect(screen.getByLabelText("Asset tag")).toBeVisible();
  });

  it("uses the exact form key when reporting an answer change", () => {
    const onValueChange = renderFields();
    fireEvent.change(screen.getByLabelText("Summary (Required)"), {
      target: { value: "VPN sign-in fails" },
    });
    expect(onValueChange).toHaveBeenCalledWith("summary", "VPN sign-in fails");
  });
});
