import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteStatus,
} from "./autocomplete";

const fruits = ["Apple", "Banana", "Cherry", "Dragonfruit"];

const meta = {
  title: "Primitives/Autocomplete",
  component: Autocomplete,
} satisfies Meta<typeof Autocomplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Autocomplete {...args} items={fruits}>
      <AutocompleteInput aria-label="Search fruit" showTrigger />
      <AutocompletePopup>
        <AutocompleteList>
          {(item: string) => (
            <AutocompleteItem key={item}>{item}</AutocompleteItem>
          )}
        </AutocompleteList>
        <AutocompleteEmpty>No matches found.</AutocompleteEmpty>
      </AutocompletePopup>
    </Autocomplete>
  ),
};

export const Open: Story = {
  render: (args) => (
    <Autocomplete {...args} inline items={fruits} open>
      <AutocompleteInput aria-label="Search fruit" showClear />
      <AutocompleteList>
        {(item: string) => (
          <AutocompleteItem key={item}>{item}</AutocompleteItem>
        )}
      </AutocompleteList>
      <AutocompleteEmpty>No matches found.</AutocompleteEmpty>
      <AutocompleteStatus>Results are available.</AutocompleteStatus>
    </Autocomplete>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <Autocomplete {...args} items={fruits}>
      <AutocompleteInput aria-label="Search fruit" disabled showTrigger />
    </Autocomplete>
  ),
};
