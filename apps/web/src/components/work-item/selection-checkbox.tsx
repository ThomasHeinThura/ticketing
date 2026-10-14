import { Checkbox } from "@taskdesk/ui";
import type { ComponentProps } from "react";

/**
 * The shared `Checkbox`, behind its own module so the work list can load it lazily: it is only
 * needed once selection mode is on, and importing it statically reshapes the work route's shared
 * Base UI chunks (G11 work-list LCP).
 */
export default function SelectionCheckbox(
  props: ComponentProps<typeof Checkbox>,
) {
  return <Checkbox {...props} />;
}
