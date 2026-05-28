// Shared date formatting so every screen renders timestamps the same way.
// `formatDateTime` is the compact list/reference form (no seconds — that
// precision is noise outside an audit trail). `formatTimestamp` keeps the
// full form for the milestone trail, where REQUESTED→APPLIED latency is read
// down to the second.

const COMPACT: Intl.DateTimeFormatOptions = {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
};
const PRECISE: Intl.DateTimeFormatOptions = { ...COMPACT, second: "2-digit" };

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, COMPACT);
}

// Same readable shape as formatDateTime but keeps seconds — used in the
// milestone trail where REQUESTED→APPLIED latency is read to the second.
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, PRECISE);
}

// ISO-style local forms for the device-detail view: stable, locale-independent,
// year + 24h + seconds. `formatDateIso` keys the day-group headers,
// `formatTime24` the per-row time, `formatDateTimeFull` the header timestamp.
const pad = (n: number) => String(n).padStart(2, "0");

export function formatDateIso(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTime24(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDateTimeFull(iso: string): string {
  return `${formatDateIso(iso)} ${formatTime24(iso)}`;
}
