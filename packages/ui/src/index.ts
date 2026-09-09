// packages/ui — the single source of UI primitives (AGENTS.md rule 1).
//
// This is a first coherent slice (contract batch C1, issue #9): the primitives
// below are extracted from apps/web/src/components/ui, all Base UI based (or
// dependency-free), with no live Radix usage. The remaining ~45 primitives
// (including the two that still use Radix's `Slot` — form.tsx, timeline.tsx —
// and every overlay/portal-based primitive) move in a later slice.

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
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "./components/progress";
export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export { Spinner } from "./components/spinner";
export { Textarea, type TextareaProps } from "./components/textarea";
export { cn } from "./lib/cn";
