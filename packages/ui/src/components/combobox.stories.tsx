import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
} from "./combobox";

const fruits = ["Apple", "Banana", "Cherry"];

const meta = {
  title: "Primitives/Combobox",
  component: Combobox,
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Combobox defaultValue="Apple" items={fruits}>
      <ComboboxInput aria-label="Fruit" showTrigger />
      <ComboboxPopup>
        <ComboboxGroup>
          <ComboboxGroupLabel>Fruit</ComboboxGroupLabel>
          <ComboboxStatus>Choose a fruit.</ComboboxStatus>
          <ComboboxList>
            {(item: string) => <ComboboxItem key={item}>{item}</ComboboxItem>}
          </ComboboxList>
        </ComboboxGroup>
        <ComboboxEmpty>No matches found.</ComboboxEmpty>
      </ComboboxPopup>
    </Combobox>
  ),
};

export const WithClearButton: Story = {
  render: () => (
    <Combobox defaultValue="Apple" items={fruits}>
      <ComboboxInput
        aria-label="Fruit"
        clearLabel="Clear selection"
        showClear
      />
    </Combobox>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Combobox defaultValue={["Apple"]} items={fruits} multiple>
      <ComboboxChips>
        <ComboboxChip removeLabel="Remove Apple">Apple</ComboboxChip>
        <ComboboxChipsInput aria-label="Fruit" />
      </ComboboxChips>
    </Combobox>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Combobox defaultValue="Apple" items={fruits}>
      <ComboboxInput aria-label="Fruit" disabled showTrigger />
    </Combobox>
  ),
};
