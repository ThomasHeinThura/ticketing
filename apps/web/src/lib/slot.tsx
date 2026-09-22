/**
 * A project-owned `Slot` — the "render as child" pattern, taken over from
 * `@radix-ui/react-slot` rather than kept as a dependency (#9).
 *
 * `form.tsx`'s `FormControl` and `timeline.tsx`'s `TimelineDate`/`TimelineContent`
 * (`asChild`) both need to merge props (aria-*, `data-slot`, `className`, `style`, event
 * handlers, `ref`) onto their single child element instead of wrapping it in an extra DOM
 * node. Base UI's `useRender` is a different shape: it renders a `render` prop the *caller*
 * supplies, or a `defaultTagName` when no `render` is given — it does not unconditionally
 * merge onto whatever single child is passed the way Radix's `Slot` does, and switching
 * `FormControl`/`TimelineDate` to it would require rewriting every call site's shape rather
 * than swapping the import. `mergeProps` below reproduces `@radix-ui/react-slot@1.3.3`'s own
 * `mergeProps` algorithm exactly (event handlers compose child-then-slot, `style` merges
 * with the child's own values winning, `className` joins both with a space, every other
 * shared prop lets the child's own value win) so this is a drop-in behavioral match for the
 * two real call sites in this codebase. Radix's `Slottable`/lazy-children support is not
 * reproduced — neither file uses it, and grep confirms nothing else in the repo imports
 * `Slottable` from either `@radix-ui/react-slot` or the `radix-ui` umbrella.
 */
import * as React from "react";

function composeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref !== null && ref !== undefined) {
        (ref as React.RefObject<T | null>).current = node;
      }
    }
  };
}

function getElementRef(
  element: React.ReactElement,
): React.Ref<unknown> | undefined {
  // React 19's public `ReactElement` type carries `ref` as an ordinary prop, not as a
  // top-level `element.ref` field (that only exists on the older / legacy element shape) —
  // reading it off `props` is the React-19-correct form.
  return (element.props as { ref?: React.Ref<unknown> }).ref;
}

function mergeProps(
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
): Record<string, unknown> {
  const overrideProps: Record<string, unknown> = { ...childProps };

  for (const propName in childProps) {
    const slotPropValue = slotProps[propName];
    const childPropValue = childProps[propName];
    const isHandler = /^on[A-Z]/.test(propName);

    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args: unknown[]) => {
          const result = (childPropValue as (...a: unknown[]) => unknown)(
            ...args,
          );
          (slotPropValue as (...a: unknown[]) => unknown)(...args);
          return result;
        };
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue;
      }
    } else if (propName === "style") {
      overrideProps[propName] = {
        ...(slotPropValue as React.CSSProperties | undefined),
        ...(childPropValue as React.CSSProperties | undefined),
      };
    } else if (propName === "className") {
      overrideProps[propName] = [slotPropValue, childPropValue]
        .filter(Boolean)
        .join(" ");
    }
  }

  return { ...slotProps, ...overrideProps };
}

/** Same prop shape `@radix-ui/react-slot`'s own `Slot` exported (`SlotProps`). */
export type SlotProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
};

/**
 * Merges its props onto its single child element instead of rendering a wrapper node.
 * Throws when given anything other than exactly one valid React element child — including a
 * falsy child (`null`, `undefined`, `false`). This is stricter than
 * `@radix-ui/react-slot`'s `Slot`, which returns a falsy child as-is (rendering nothing)
 * instead of throwing; every call site in this repo always passes exactly one element, so
 * the difference is not reachable today.
 */
export const Slot = React.forwardRef<HTMLElement, SlotProps>(
  ({ children, ...slotProps }, forwardedRef) => {
    if (
      !React.isValidElement(children) ||
      React.Children.count(children) !== 1
    ) {
      throw new Error(
        "Slot failed to slot onto its children. Expected a single React element child.",
      );
    }

    const childRef = getElementRef(children);
    const mergedProps = mergeProps(
      slotProps as Record<string, unknown>,
      (children.props as Record<string, unknown>) ?? {},
    );

    if (children.type !== React.Fragment) {
      mergedProps.ref = forwardedRef
        ? composeRefs(forwardedRef, childRef as React.Ref<HTMLElement>)
        : childRef;
    }

    return React.cloneElement(children, mergedProps);
  },
);
Slot.displayName = "Slot";
