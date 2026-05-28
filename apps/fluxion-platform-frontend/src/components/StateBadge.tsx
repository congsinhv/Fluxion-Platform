import type { StateType } from "@/graphql/generated/graphql";

const FG: Record<string, string> = {
  IDLE: "text-state-idle",
  REGISTERED: "text-state-registered",
  ENROLLED: "text-state-enrolled",
  ACTIVE: "text-state-active",
  LOCKED: "text-state-locked",
  RELEASED: "text-state-released",
};
const BG: Record<string, string> = {
  IDLE: "bg-state-bg-idle",
  REGISTERED: "bg-state-bg-registered",
  ENROLLED: "bg-state-bg-enrolled",
  ACTIVE: "bg-state-bg-active",
  LOCKED: "bg-state-bg-locked",
  RELEASED: "bg-state-bg-released",
};

export function StateBadge({ type, label }: { type: StateType | string; label?: string }) {
  const t = String(type);
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${FG[t] ?? "text-muted"} ${BG[t] ?? "bg-rule"}`}>
      {label ?? t}
    </span>
  );
}
