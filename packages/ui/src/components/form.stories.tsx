import type { Meta, StoryObj } from "@storybook/react-vite";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "./form";
import { Input } from "./input";

const meta = {
  title: "Primitives/Form",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Values = { email: string };

function EmailForm() {
  const form = useForm<Values>({ defaultValues: { email: "" } });

  return (
    <Form {...form}>
      <form className="w-80 space-y-4" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                <Input autoComplete="email" type="email" {...field} />
              </FormControl>
              <FormDescription>Used for account notifications.</FormDescription>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

export const Default: Story = {
  render: () => <EmailForm />,
};
