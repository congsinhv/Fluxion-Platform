import { useEffect, type ReactNode } from "react";
import { IconClose } from "@/components/icons";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-paper rounded-lg shadow-xl w-full ${maxWidth} flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink p-1 rounded-md hover:bg-paper-2"
            aria-label="Close"
          >
            <IconClose />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto max-h-[70vh]">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-rule flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
