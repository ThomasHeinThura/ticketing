import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Button } from "@taskdesk/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { memo } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CalendarMetadata } from "@/hooks/use-service-calendar-editor";
import { isValidIanaTimezone } from "@/lib/service-calendar-form";
import { CalendarDetailsCard } from "./calendar-details-card";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MemoizedCalendarDetailsCard = memo(CalendarDetailsCard);
const metadataSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u, "Invalid stable key"),
  name: z.string().trim().min(1, "Name is required").max(120),
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required")
    .refine(isValidIanaTimezone, "Invalid timezone"),
});

function CalendarFormHarness({
  disabled = false,
  onSubmit = () => undefined,
}: {
  disabled?: boolean;
  onSubmit?: (values: CalendarMetadata) => void;
} = {}) {
  const form = useForm<CalendarMetadata>({
    resolver: standardSchemaResolver(metadataSchema),
    defaultValues: { key: "", name: "", timezone: "" },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <MemoizedCalendarDetailsCard form={form} isNew disabled={disabled} />
      <Button type="submit">Create calendar</Button>
      <Button
        type="button"
        onClick={() =>
          form.reset(
            { key: "support", name: "Support", timezone: "UTC" },
            { keepFieldsRef: true },
          )
        }
      >
        Reset calendar
      </Button>
    </form>
  );
}

describe("CalendarDetailsCard validation", () => {
  it("retains free typed valid IANA aliases across blur and submits the controlled value after reset", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<CalendarFormHarness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset calendar" }));
    const input = screen.getByRole("combobox", { name: "details.timezone" });
    await waitFor(() => expect(input).toHaveValue("UTC"));
    fireEvent.change(input, { target: { value: "Etc/GMT+12" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Etc/GMT+12");
    fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { key: "support", name: "Support", timezone: "Etc/GMT+12" },
        expect.anything(),
      ),
    );
    expect(container.querySelector("datalist, input[list]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset calendar" }));
    await waitFor(() => expect(input).toHaveValue("UTC"));
  });

  it("closes timezone suggestions and disables input when permission is lost", async () => {
    const { rerender } = render(<CalendarFormHarness />);
    const input = screen.getByRole("combobox", { name: "details.timezone" });
    input.focus();
    fireEvent.input(input, {
      target: { value: "Europe/Lon" },
      inputType: "insertText",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Europe/London" }),
      ).toBeInTheDocument(),
    );
    rerender(<CalendarFormHarness disabled />);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(input).toBeDisabled();
    rerender(<CalendarFormHarness />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders invalid key, name, and timezone after submit with a stable memoized form prop", async () => {
    render(<CalendarFormHarness />);

    fireEvent.change(screen.getByLabelText("details.stableKeyLabel"), {
      target: { value: "Not a stable key" },
    });
    fireEvent.change(screen.getByLabelText("details.name"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("details.timezone"), {
      target: { value: "Not/A-Timezone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));

    await waitFor(() => {
      expect(screen.getByLabelText("details.stableKeyLabel")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByLabelText("details.name")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByLabelText("details.timezone")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(screen.getByText("Invalid stable key")).toBeVisible();
    expect(screen.getByText("Name is required")).toBeVisible();
    expect(screen.getByText("Invalid timezone")).toBeVisible();
  });
});
