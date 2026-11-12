"use client";

import { Toast } from "@base-ui/react/toast";
import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn";
import { Card, CardDescription, CardTitle } from "./card";
import { loadToastContents, warmToastContents } from "./toast-loader";

const toastManager = Toast.createToastManager();
const anchoredToastManager = Toast.createToastManager();

const createContents = () =>
  lazy(() =>
    loadToastContents().catch((error: unknown) => {
      ToastContents = createContents();
      throw error;
    }),
  );
let ToastContents = createContents();

class ToastContentsBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    notification: string | undefined;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.notification !== this.props.notification)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ToastTextFallback({ onReady }: { onReady: () => void }) {
  const { toasts } = Toast.useToastManager();
  useLayoutEffect(onReady, [onReady]);
  return toasts
    .filter((toast) => toast.transitionStatus !== "ending")
    .map((toast) => (
      <Card
        key={toast.id}
        className="mb-2 rounded-lg bg-popover p-3 text-popover-foreground shadow-lg"
      >
        <CardTitle>{toast.title}</CardTitle>
        <CardDescription>{toast.description}</CardDescription>
      </Card>
    ));
}

type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

interface ToastProviderProps extends Toast.Provider.Props {
  position?: ToastPosition;
}

function PendingToastContents({ onPending }: { onPending: () => void }) {
  useLayoutEffect(onPending, [onPending]);
  return null;
}

/** Load notification contents on demand while the live region stays mounted. */
function DeferredToastViewport({
  position = "bottom-right",
  anchored = false,
  timeout,
}: {
  position?: ToastPosition;
  anchored?: boolean;
  timeout: number;
}) {
  const { toasts, update } = Toast.useToastManager();
  const [visible, setVisible] = useState(false);
  const onReady = useCallback(() => setVisible(true), []);
  const onPending = useCallback(() => setVisible(false), []);
  const held = useRef(new Map<string, number>());
  useEffect(warmToastContents, []);
  useLayoutEffect(() => {
    for (const toast of toasts) {
      if (toast.transitionStatus === "ending") {
        held.current.delete(toast.id);
        continue;
      }
      if (!visible) {
        if (!held.current.has(toast.id) || toast.timeout !== 0) {
          held.current.set(toast.id, toast.timeout ?? timeout);
          update(toast.id, { timeout: 0 });
        }
      } else if (held.current.has(toast.id)) {
        const duration = held.current.get(toast.id);
        held.current.delete(toast.id);
        update(toast.id, { timeout: duration });
      }
    }
  }, [toasts, update, visible, timeout]);
  if (toasts.length === 0) return null;
  return (
    <ToastContentsBoundary
      notification={toasts[0]?.id}
      fallback={<ToastTextFallback onReady={onReady} />}
    >
      <Suspense fallback={<PendingToastContents onPending={onPending} />}>
        <ToastContents
          position={position}
          anchored={anchored}
          onReady={onReady}
        />
      </Suspense>
    </ToastContentsBoundary>
  );
}

function ToastProvider({
  children,
  position = "bottom-right",
  ...props
}: ToastProviderProps) {
  return (
    <Toast.Provider toastManager={toastManager} {...props}>
      {children}
      <Toast.Portal data-slot="toast-portal">
        <Toast.Viewport
          className={cn(
            "fixed z-[200] mx-auto flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]",
            // Vertical positioning
            "data-[position*=top]:top-(--toast-inset)",
            "data-[position*=bottom]:bottom-(--toast-inset)",
            // Horizontal positioning
            "data-[position*=left]:left-(--toast-inset)",
            "data-[position*=right]:right-(--toast-inset)",
            "data-[position*=center]:-translate-x-1/2 data-[position*=center]:left-1/2",
          )}
          data-position={position}
          data-slot="toast-viewport"
        >
          <DeferredToastViewport
            position={position}
            timeout={props.timeout ?? 5_000}
          />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function AnchoredToastProvider({ children, ...props }: Toast.Provider.Props) {
  return (
    <Toast.Provider toastManager={anchoredToastManager} {...props}>
      {children}
      <Toast.Portal data-slot="toast-portal-anchored">
        <Toast.Viewport
          className="outline-none"
          data-slot="toast-viewport-anchored"
        >
          <DeferredToastViewport anchored timeout={props.timeout ?? 5_000} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

export {
  AnchoredToastProvider,
  anchoredToastManager,
  type ToastPosition,
  ToastProvider,
  toastManager,
};
