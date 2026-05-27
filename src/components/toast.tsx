"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, X, type LucideIcon } from "lucide-react";

export type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  duration?: number;
  action?: { label: string; onAction: () => void };
};

type ConfirmState = { message: string; resolve: (v: boolean) => void } | null;

type ToastContextType = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  confirm: (message: string) => Promise<boolean>;
};

const ToastContext = createContext<ToastContextType | null>(null);
let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${++toastId}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    const duration = toast.duration ?? 4000;
    if (duration > 0) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => setConfirmState({ message, resolve }));
  }, []);

  function handleConfirm(result: boolean) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, confirm }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 max-w-sm">
        {toasts.map((toast) => {
          const iconMap: Record<string, LucideIcon> = { success: CheckCircle2, error: AlertTriangle, info: AlertTriangle };
          const Icon = iconMap[toast.type] ?? AlertTriangle;
          const colorMap = { success: "border-[#298b68] bg-[#f0faf5]", error: "border-[#ef4444] bg-[#fef2f2]", info: "border-[#3a82f7] bg-[#ebf3fe]" };
          return (
            <div key={toast.id} className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg ${colorMap[toast.type]}`}>
              <Icon size={16} className="shrink-0 mt-0.5" style={{ color: toast.type === "success" ? "#298b68" : toast.type === "error" ? "#ef4444" : "#3a82f7" }} />
              <p className="text-sm flex-1">{toast.message}</p>
              {toast.action ? (
                <button className="text-xs font-semibold text-[#1b5e4a] hover:underline shrink-0" onClick={toast.action.onAction} type="button">{toast.action.label}</button>
              ) : null}
              <button className="shrink-0 text-[#66706a] hover:text-[#111714]" onClick={() => removeToast(toast.id)} type="button"><X size={14} /></button>
            </div>
          );
        })}
      </div>
      {confirmState ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <p className="text-sm font-medium text-[#1b1f23]">{confirmState.message}</p>
            <div className="mt-4 flex gap-3 justify-end">
              <button className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-4 text-sm font-medium text-[#66706a] hover:bg-[#eef1ee]" onClick={() => handleConfirm(false)} type="button">Cancel</button>
              <button className="inline-flex h-9 items-center rounded-md bg-[#1b5e4a] px-4 text-sm font-medium text-white hover:bg-[#164d3d]" onClick={() => handleConfirm(true)} type="button">Confirm</button>
            </div>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
