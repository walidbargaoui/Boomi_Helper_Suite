type ToastApi = {
  addToast: (toast: {
    message: string;
    type: "success" | "error" | "info";
    duration?: number;
    action?: { label: string; onAction: () => void };
  }) => void;
};

export function runUndoableAction(
  toast: ToastApi,
  message: string,
  action: () => Promise<void>,
  delayMs = 5000,
): void {
  const timeoutId = setTimeout(async () => {
    await action();
  }, delayMs);
  toast.addToast({
    message,
    type: "info",
    duration: delayMs,
    action: {
      label: "Undo",
      onAction: () => clearTimeout(timeoutId),
    },
  });
}
