// Pure mapping of a config action's state pair to how the Actions table
// renders its "From → To" cell. NOTIFY-style actions keep the device in the
// same state, so they show a single badge + "unchanged" note instead of an
// arrow pair (mirrors docs/design-proposals/admin/config-actions.html).
export interface ActionStates {
  fromState?: { type: string } | null;
  targetState?: { type: string } | null;
}

export type Transition =
  | { kind: "transition"; from: string; to: string }
  | { kind: "unchanged"; from: string }
  | { kind: "enter"; to: string }
  | { kind: "none" };

export function actionTransition(a: ActionStates): Transition {
  const from = a.fromState?.type ?? null;
  const to = a.targetState?.type ?? null;
  if (from && to && from !== to) return { kind: "transition", from, to };
  if (from && (!to || to === from)) return { kind: "unchanged", from };
  // Entry action (e.g. UPLOAD): no origin state, lands the device in `to`.
  if (!from && to) return { kind: "enter", to };
  return { kind: "none" };
}
