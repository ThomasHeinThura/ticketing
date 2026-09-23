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
