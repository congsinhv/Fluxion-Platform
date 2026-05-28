import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "info" | "success" | "error";
interface Toast { id: number; kind: ToastKind; text: string }

interface ToastCtxValue { push: (kind: ToastKind, text: string) => void }

const ToastCtx = createContext<ToastCtxValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "px-4 py-2 rounded-md shadow-md text-sm font-medium text-white " +
              (t.kind === "success" ? "bg-state-active" : t.kind === "error" ? "bg-state-locked" : "bg-accent")
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastCtxValue {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be used inside ToastProvider");
  return v;
}
