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

function CalendarFormHarness() {
  const form = useForm<CalendarMetadata>({
    resolver: standardSchemaResolver(metadataSchema),
    defaultValues: { key: "", name: "", timezone: "" },
  });
  return (
    <form onSubmit={form.handleSubmit(() => undefined)}>
      <MemoizedCalendarDetailsCard form={form} isNew />
      <Button type="submit">Create calendar</Button>
    </form>
  );
}

describe("CalendarDetailsCard validation", () => {
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
