// Turns raw milestone rows into a flat, plain-language device history — NO
// request/applied pairing. Each milestone renders as its own line, newest
// first, grouped by calendar day. The two milestone kinds read differently:
//   REQUESTED  → "{actor} requested to {verb the device}."
//   APPLIED    → "{Device verbed}. Device's state changed from X to Y."
// FAILED is phrased off the request verb ("Failed to {verb the device}.").

import { formatDateIso } from "@/lib/format-date";

export interface StateRef { type: string; name: string }

export interface HistoryMilestone {
  id: string;
  eventType: "REQUESTED" | "APPLIED" | "FAILED";
  createdAt: string;
  action: { type: string; name: string };
  fromState?: StateRef | null;
  toState?: StateRef | null;
  requestedBy?: { email: string; displayName?: string | null } | null;
}

// How the device state moved, used to pick the state clause.
//   changed → from + to differ   set → no prior state (origin)
//   stayed  → in-place           none → no state clause
type StateMode = "changed" | "set" | "stayed" | "none";

export interface HistoryEntry {
  id: string;
  at: string;
  kind: "request" | "transition" | "failed";
  byUser: boolean;          // user icon vs system (gear) icon
  actor?: string;           // request rows: "admin@…" or "System"
  lead: string;             // bold-ish phrase ("Device activated" / "activate the device")
  attachService?: boolean;  // request rows that assign the service (REGISTER)
  from?: StateRef | null;
  to?: StateRef | null;
  stateMode: StateMode;
}

// type → human verb phrases. `request` is the imperative ("activate the
// device"); `applied` is the past-tense outcome ("Device activated").
const PHRASES: Record<string, { request: string; applied: string }> = {
  UPLOAD: { request: "upload the device", applied: "Device uploaded" },
  REGISTER: { request: "register the device", applied: "Device registered" },
  ENROLL: { request: "enroll the device", applied: "Device enrolled" },
  ACTIVATE: { request: "activate the device", applied: "Device activated" },
  LOCK: { request: "lock the device", applied: "Device locked" },
  UNLOCK: { request: "unlock the device", applied: "Device unlocked" },
  RELEASE: { request: "release the device", applied: "Device released" },
  NOTIFY_FROM_ACTIVE: { request: "send a notification", applied: "Notification sent" },
  NOTIFY_FROM_LOCKED: { request: "send a notification", applied: "Notification sent" },
};

function phrasesFor(action: { type: string; name: string }) {
  if (PHRASES[action.type]) return PHRASES[action.type];
  if (action.type.startsWith("NOTIFY")) return { request: "send a notification", applied: "Notification sent" };
  // Unknown config action — degrade to its display name, never blank.
  return { request: `run ${action.name}`, applied: `${action.name} applied` };
}

function transitionMode(from?: StateRef | null, to?: StateRef | null): StateMode {
  if (!to && !from) return "none";
  if (!from && to) return "set";
  if (from && to && from.type !== to.type) return "changed";
  return "stayed"; // from === to (in-place), or only a from
}

export function describeMilestone(m: HistoryMilestone): HistoryEntry {
  const p = phrasesFor(m.action);
  if (m.eventType === "REQUESTED") {
    return {
      id: m.id, at: m.createdAt, kind: "request",
      byUser: !!m.requestedBy,
      actor: m.requestedBy ? (m.requestedBy.displayName || m.requestedBy.email) : "System",
      lead: p.request,
      attachService: m.action.type === "REGISTER",
      stateMode: "none",
    };
  }
  if (m.eventType === "FAILED") {
    return {
      id: m.id, at: m.createdAt, kind: "failed", byUser: false,
      lead: p.request, from: m.fromState, to: m.fromState,
      stateMode: m.fromState ? "stayed" : "none",
    };
  }
  // APPLIED — written by the system (applier), so always the gear marker.
  return {
    id: m.id, at: m.createdAt, kind: "transition", byUser: false,
    lead: p.applied, from: m.fromState, to: m.toState,
    stateMode: transitionMode(m.fromState, m.toState),
  };
}

export function buildHistory(milestones: HistoryMilestone[]): HistoryEntry[] {
  // The UPLOAD milestone is the device's origin row ("Device uploaded."), so no
  // synthetic entry is needed — every device enters via an UPLOAD milestone pair.
  return [...milestones]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(describeMilestone);
}

export interface HistoryDay { date: string; rows: HistoryEntry[] }

// Group a newest-first entry list into consecutive day buckets.
export function groupByDay(entries: HistoryEntry[]): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const e of entries) {
    const date = formatDateIso(e.at);
    const last = days[days.length - 1];
    if (last && last.date === date) last.rows.push(e);
    else days.push({ date, rows: [e] });
  }
  return days;
}
