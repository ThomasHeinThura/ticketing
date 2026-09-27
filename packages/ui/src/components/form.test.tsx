import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";
import { Input } from "./input";

afterEach(() => {
  cleanup();
});

type Values = { name: string };

function NameForm({ triggerValidation }: { triggerValidation?: boolean }) {
  const form = useForm<Values>({
    defaultValues: { name: "" },
    resolver: () => ({
      values: {},
      errors: { name: { type: "required", message: "Name is required" } },
    }),
  });

  // `errors` is meant for a server-driven form, not a plain object literal — passing one
  // built fresh every render re-triggers react-hook-form's internal effect on every
  // render, in an infinite loop. Triggering validation once, imperatively, is the stable
  // way to get a real field error into the rendered tree for this test.
  useEffect(() => {
    if (triggerValidation) form.trigger();
  }, [triggerValidation, form.trigger]);

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormDescription>Used to identify your profile.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("Form", () => {
  it("renders the field's label and input, wired together", () => {
    render(<NameForm />);
    const input = screen.getByLabelText("Name");
    expect(input).toBeInTheDocument();
  });

  it("renders nothing from FormMessage when there is no error", () => {
    render(<NameForm />);
    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();
  });

  it("renders a field error via FormMessage once validation runs", async () => {
    render(<NameForm triggerValidation />);
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("has no accessibility violations for a labeled field", async () => {
    const { baseElement } = render(<NameForm />);

    await expectNoA11yViolations(baseElement);
  });
});
