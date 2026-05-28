import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="text-base font-medium text-ink-soft">{title}</div>
      {hint && <div className="mt-2 text-sm text-muted">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="card p-10 text-center text-sm text-muted">{label}</div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card p-6 border-state-locked/40 bg-state-bg-locked/40 text-sm text-state-locked">
      {message}
    </div>
  );
}
