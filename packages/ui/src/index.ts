// packages/ui — the single source of UI primitives (AGENTS.md rule 1).
//
// Batch 2 (issue #9): nine leaf primitives added on top of the first slice (contract
// batch C1) — checkbox, collapsible, radio-group, scroll-area, slider, switch, tabs,
// toggle, tooltip. All Base UI based, with no live Radix usage. `avatar` was
// considered for this batch and dropped: its `AvatarImage` couples to
// `apps/web`'s `resolveAvatarSrc`, which reads the web app's API base URL from its build env — an
// app-bootstrap concern that does not belong in a dependency-free design-system
// package, and every real call site passes an unresolved `/api/...` path, so moving it
// as-is would either leak env-reading into `packages/ui` or require repointing ~20
// call sites to pre-resolve `src` themselves — out of scope for a bounded leaf-primitive
// batch.
//
// Batch 3 (issue #9): ten more leaf primitives — accordion, checkbox-group,
// circular-progress, input-group, number-field, popover, preview-card, table, toggle-group,
// toolbar. All Base UI based (or, for table/circular-progress, no primitive library at
// all). `breadcrumb` and `pagination` were considered and dropped: both read
// `react-i18next`/an app `i18n` module for their `aria-label`s, which `packages/ui` does
// not depend on and this relocation-only batch may not add. `menubar` was considered and
// dropped: it composes the still-local `apps/web/src/components/ui/menu.tsx`, which has
// not moved yet. `loading-skeleton` was considered and dropped: it is a hardcoded mock of
// this app's own sidebar/nav shell (workspace, issues, views literal labels), not a
// generic design-system primitive. The remaining ~24 primitives (including the two that
// still use Radix's `Slot` — form.tsx, timeline.tsx — and every other overlay/portal-based
// primitive) move in a later slice.
//
// Batch 4 (issue #9): seven more leaf primitives from the overlay/menu family —
// alert-dialog, autocomplete, command, context-menu, menu, menubar, select. All Base UI
// based, with no live Radix usage. `menubar` composes the now-moved `menu`
// (package-internal `./menu` import); `command` composes the now-moved `autocomplete`
// (package-internal `./autocomplete` import) and its own copy's `Input`/`ScrollArea`
// imports were repointed from `@taskdesk/ui` (which would have been circular from inside
// the package) to the package-internal `./input`/`./scroll-area`. `dialog`, `sheet` and
// `combobox` were considered and dropped: all three read `i18n` from `@/lib/i18n` for a
// close-button `aria-label`, which `packages/ui` does not depend on and this
// relocation-only batch may not add. `input-otp` was considered and dropped: it depends
// on the `input-otp` npm package, which is a dependency of `apps/web` but not of
// `packages/ui` — adding it would mean touching `packages/ui/package.json`, out of scope
// for a relocation-only batch. The remaining ~17 primitives (including `avatar.tsx` and
// `error-boundary.tsx`, still un-de-Sentry'd; `form.tsx`/`timeline.tsx`, still on Radix
// `Slot`; `breadcrumb.tsx`/`pagination.tsx`, still on `react-i18next`/`i18n`; `dialog.tsx`,
// `sheet.tsx`, `combobox.tsx`, blocked on the same `i18n` dependency; `input-otp.tsx`,
// blocked on the `input-otp` package dependency; and `loading-skeleton.tsx`, an
// app-specific shell mock, not a generic primitive) move in a later slice.

export {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionPanel as AccordionContent,
  AccordionTrigger,
} from "./components/accordion";
export {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "./components/alert";
export {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBackdrop as AlertDialogOverlay,
  AlertDialogClose,
  AlertDialogCreateHandle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogPopup as AlertDialogContent,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogViewport,
} from "./components/alert-dialog";
export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
  AutocompleteRow,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  AutocompleteValue,
  useAutocompleteFilter,
} from "./components/autocomplete";
export { Badge, badgeVariants } from "./components/badge";
export { Button, type ButtonProps, buttonVariants } from "./components/button";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardFrame,
  CardFrameDescription,
  CardFrameFooter,
  CardFrameHeader,
  CardFrameTitle,
  CardHeader,
  CardPanel,
  CardTitle,
} from "./components/card";
export { Checkbox } from "./components/checkbox";
export { CheckboxGroup } from "./components/checkbox-group";
export { CircularProgress } from "./components/circular-progress";
export {
  Collapsible,
  CollapsibleContent,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "./components/collapsible";
export {
  Command,
  CommandCollection,
  CommandCreateHandle,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "./components/command";
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/context-menu";
export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/empty";
export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldItem,
  FieldLabel,
  FieldValidity,
} from "./components/field";
export { Fieldset, FieldsetLegend } from "./components/fieldset";
export {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "./components/frame";
export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  Group,
  GroupSeparator,
  GroupText,
  groupVariants,
} from "./components/group";
export { Input, type InputProps } from "./components/input";
export {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./components/input-group";
export { Kbd, KbdGroup, KbdSequence } from "./components/kbd";
export { Label } from "./components/label";
export {
  Menu,
  Menu as DropdownMenu,
  MenuCheckboxItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  MenuGroup,
  MenuGroup as DropdownMenuGroup,
  MenuGroupLabel,
  MenuGroupLabel as DropdownMenuLabel,
  MenuItem,
  MenuItem as DropdownMenuItem,
  MenuPopup,
  MenuPopup as DropdownMenuContent,
  MenuPortal,
  MenuPortal as DropdownMenuPortal,
  MenuRadioGroup,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuSeparator,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub,
  MenuSub as DropdownMenuSub,
  MenuSubPopup,
  MenuSubPopup as DropdownMenuSubContent,
  MenuSubTrigger,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
} from "./components/menu";
export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "./components/menubar";
export {
  Meter,
  MeterIndicator,
  MeterLabel,
  MeterTrack,
  MeterValue,
} from "./components/meter";
export {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldScrubArea,
} from "./components/number-field";
export {
  Popover,
  PopoverClose,
  PopoverCreateHandle,
  PopoverDescription,
  PopoverPopup,
  PopoverPopup as PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./components/popover";
export {
  PreviewCard,
  PreviewCard as HoverCard,
  PreviewCardPopup,
  PreviewCardPopup as HoverCardContent,
  PreviewCardTrigger,
  PreviewCardTrigger as HoverCardTrigger,
} from "./components/preview-card";
export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "./components/progress";
export {
  Radio,
  RadioGroup,
  RadioGroupItem,
} from "./components/radio-group";
export { ScrollArea, ScrollBar } from "./components/scroll-area";
export {
  Select,
  SelectButton,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
} from "./components/select";
export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export { Slider, SliderValue } from "./components/slider";
export { Spinner } from "./components/spinner";
export { Switch } from "./components/switch";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/table";
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsPanel,
  TabsTab,
  TabsTrigger,
} from "./components/tabs";
export { Textarea, type TextareaProps } from "./components/textarea";
export { Toggle, toggleVariants } from "./components/toggle";
export {
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupSeparator,
} from "./components/toggle-group";
export {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
  ToolbarLink,
  ToolbarSeparator,
} from "./components/toolbar";
export {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "./components/tooltip";
export { cn } from "./lib/cn";
