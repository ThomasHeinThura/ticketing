import { toastManager } from "@taskdesk/ui";
import { copyErrorReference } from "@/lib/copy-error-reference";
import { HttpError } from "@/lib/http-error";
import { i18n } from "@/lib/i18n";

type ToastVariant = "success" | "error" | "info" | "warning";

type ToastAction = {
  label: string;
  onClick?: () => void;
};

type ToastOptions = {
  description?: string;
  error?: unknown;
  action?: ToastAction;
  cancel?: ToastAction;
};

function addToast(
  title: string,
  variant?: ToastVariant,
  options?: ToastOptions,
) {
  let id = "";

  const action = options?.action ?? options?.cancel;

  id = toastManager.add({
    title,
    description: options?.description,
    type: variant,
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            action.onClick?.();
            toastManager.close(id);
          },
        }
      : undefined,
  });

  return id;
}

type ToastFn = (title: string, options?: ToastOptions) => string;
type ToastId = string;

const success: ToastFn = (title, options) =>
  addToast(title, "success", options);
const error = (value: string | Error, options?: ToastOptions): string => {
  const title = typeof value === "string" ? value : value.message;
  const source = options?.error ?? value;
  if (
    !(source instanceof HttpError) ||
    source.status < 500 ||
    !source.requestId
  )
    return addToast(title, "error", options);
  const requestId = source.requestId;
  return addToast(title, "error", {
    ...options,
    description: [
      options?.description,
      i18n.t("common:error.reference", { id: requestId }),
    ]
      .filter(Boolean)
      .join("\n"),
    action: {
      label: i18n.t("common:error.copyReference"),
      onClick: () => {
        void copyErrorReference(requestId);
      },
    },
  });
};
const info: ToastFn = (title, options) => addToast(title, "info", options);
const warning: ToastFn = (title, options) =>
  addToast(title, "warning", options);
const message: ToastFn = (title, options) =>
  addToast(title, undefined, options);
const loading: ToastFn = (title, options) =>
  toastManager.add({
    title,
    description: options?.description,
    type: "loading",
  });
const dismiss = (id?: ToastId) => {
  if (!id) return;
  toastManager.close(id);
};

const toast = Object.assign(message, {
  success,
  error,
  info,
  warning,
  message,
  loading,
  dismiss,
});

export type { ToastOptions };
export { toast };
