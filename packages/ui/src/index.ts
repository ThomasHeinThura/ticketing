// packages/ui — the single source of UI primitives (AGENTS.md rule 1).
// Extraction batch notes below are historical snapshots; the latest #403 disposition is
// recorded in the current-state note before Batch 6 and in docs/02-design/design-system.md.
//
// Batch 2 (issue #9): nine leaf primitives added on top of the first slice (contract
// batch C1) — checkbox, collapsible, radio-group, scroll-area, slider, switch, tabs,
// toggle, tooltip. All Base UI based, with no live Radix usage. Avatar was deferred
// from that relocation batch because its image adapter read the web app's API base URL;
// it now lives here as a pure primitive, while the web component retains that URL adapter.
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
// for a relocation-only batch. The remaining primitives (including `error-boundary.tsx`,
// still un-de-Sentry'd; `form.tsx`/`timeline.tsx`, still on Radix
// `Slot`; `breadcrumb.tsx`/`pagination.tsx`, still on `react-i18next`/`i18n`; `dialog.tsx`,
// `sheet.tsx`, `combobox.tsx`, blocked on the same `i18n` dependency; `input-otp.tsx`,
// blocked on the `input-otp` package dependency; and `loading-skeleton.tsx`, an
// app-specific shell mock, not a generic primitive) move in a later slice.
//
// Batch 5 (issue #286, found by #284's alignment check): `dialog`, `sheet` and `combobox`
// move in, unblocked by dropping the `@/lib/i18n` read in favour of a caller-supplied
// label prop — the same pattern `toggle`/`kbd`/`switch` already use. `DialogPopup` and
// `SheetPopup` take a required `closeLabel` (required only when `showCloseButton` is not
// explicitly `false`, enforced by a discriminated union); the close-button aria-label
// they used to read from `common:actions.close` is now that prop, so every caller passes
// `t("common:actions.close")` and the rendered accessible name is unchanged. `combobox`'s
// single `common:actions.remove` string labelled two different controls, so it becomes
// two props: `ComboboxInput` takes `clearLabel` (required only when `showClear` is
// `true`) and `ComboboxChip` takes `removeLabel` (always required — a chip always renders
// its own remove control). `input-otp` remains blocked on the npm dependency (separate
// issue).
//
// Historical batch notes below describe the extraction state at their original commit.
// In the #403 UI-foundation candidate, the shared Avatar now lives in packages/ui while
// its URL resolver remains in apps/web/src/components/avatar; app error compositions and
// the first-load shell are also app-owned, and apps/web/src/components/ui is empty.
// Batch 6 (issue #9): the last nine movable primitives — breadcrumb, calendar, form,
// input-otp, pagination, shortcut-number, sidebar, timeline, toast — plus the shared
// `Slot` helper (`apps/web/src/lib/slot.tsx` -> `./lib/slot.tsx`) and the mobile-breakpoint
// hook (`apps/web/src/hooks/use-mobile.ts` -> `./lib/use-mobile.ts`, re-exported as
// `useIsMobile`). `apps/web/src/components/ui` is not empty after this batch — four
// files stay, for reasons read from their own source, not assumed from the batch-3/4
// notes above. The avatar's application URL resolver stays in its thin app adapter.
//
// - `loading-skeleton.tsx` — the batch-3 finding is unchanged: a hardcoded mock of this
//   app's own sidebar/nav shell (literal `workspace`/`issues`/`projects`/`views`/`settings`
//   labels), not a generic primitive. It also has zero real importers today.
// - `error-display.tsx`, `error-fallback.tsx`, `error-test.tsx` — new to this batch's
//   judgment call, not previously assessed. `error-display.tsx` calls this app's own
//   `../../lib/error-handler` (`parseApiError`, CORS/network troubleshooting copy) and
//   hardcodes `https://taskdesk.bimats.com/docs` — app-specific error-reporting glue, not a
//   design-system primitive. `error-fallback.tsx` and `error-test.tsx` both exist only to
//   wrap `error-display.tsx`, so the same reasoning covers them; `error-test.tsx` is also a
//   manual test harness (a hardcoded fake API host), not a shipped UI surface.
//
// `breadcrumb` and `pagination` unblock the same way batch 5 did for `dialog`/`sheet`/
// `combobox`: `i18n.t()`/`useTranslation()` reads become caller-supplied label props
// (`Breadcrumb`'s `label`, `BreadcrumbEllipsis`'s `moreLabel`; `Pagination`'s `label`,
// `PaginationPrevious`/`PaginationNext`'s `ariaLabel` + `label`, `PaginationEllipsis`'s
// `moreLabel`). `pagination.tsx` has zero real importers today, so no caller needed
// updating for it. `sidebar.tsx` had the same `react-i18next` reads (`Sidebar`'s
// `mobileTitle`/`mobileDescription`/`closeLabel`, `SidebarTrigger`/`SidebarRail`'s
// `toggleLabel`) plus its own `useIsMobile` import, which moves with it. `calendar.tsx`
// read `@/store/user-preferences`'s `weekStartsOn` (a whole app-wide persisted Zustand
// store) as an internal fallback default; the fallback is dropped and `weekStartsOn`
// becomes purely a caller-supplied optional prop (react-day-picker's own default matches
// the store's initial value, so an unconfigured caller sees no change), and every
// real call site now passes its own `useUserPreferencesStore` read explicitly. `input-otp`
// and `react-day-picker` (calendar's own picker library) and `react-hook-form` (form's)
// are added to `packages/ui/package.json` at the same versions `apps/web` already pins —
// the batch-3/4 notes' objection was only ever "this needs a package.json change", which
// this batch makes. `form.tsx` and `timeline.tsx` both move onto the local `Slot` batch 3
// already anticipated (`apps/web/src/lib/slot.tsx`, itself written for exactly this
// purpose — see its own header comment) rather than Radix's, so `check:ui`'s
// `KNOWN-RADIX.md` table stays at zero rows.

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
export { Avatar, AvatarFallback, AvatarImage } from "./components/avatar";
export { Badge, badgeVariants } from "./components/badge";
export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./components/breadcrumb";
export { Button, type ButtonProps, buttonVariants } from "./components/button";
export { Calendar } from "./components/calendar";
export {
  CapabilityMatrix,
  type CapabilityMatrixItem,
  type CapabilityMatrixProps,
} from "./components/capability-matrix";
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
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxClear,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxRow,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxFilter,
} from "./components/combobox";
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
  Dialog,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogClose,
  DialogCreateHandle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "./components/dialog";
export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/empty";
export {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
  type ErrorBoundaryProps,
} from "./components/error-boundary";
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "./components/form";
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
export {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "./components/input-otp";
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
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./components/pagination";
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
export {
  Sheet,
  SheetBackdrop,
  SheetBackdrop as SheetOverlay,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetPopup as SheetContent,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "./components/sheet";
export { ShortcutNumber } from "./components/shortcut-number";
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./components/sidebar";
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
export {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "./components/timeline";
export {
  AnchoredToastProvider,
  anchoredToastManager,
  type ToastPosition,
  ToastProvider,
  toastManager,
} from "./components/toast";
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
export { springSettle } from "./lib/motion";
export { useIsMobile } from "./lib/use-mobile";
