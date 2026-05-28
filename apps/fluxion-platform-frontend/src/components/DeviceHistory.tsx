import { StateBadge } from "@/components/StateBadge";
import { IconUserSolid, IconGearSolid } from "@/components/icons";
import { formatTime24 } from "@/lib/format-date";
import { buildHistory, groupByDay, type HistoryEntry, type HistoryMilestone } from "@/components/device-history-format";

// Flat, plain-language device history grouped by day. Each row is one
// milestone: a person/gear marker, the time, then a sentence describing what
// happened (state changes render as badges). No request/applied pairing.
export function DeviceHistory({
  milestones, serviceName,
}: {
  milestones: HistoryMilestone[];
  serviceName?: string;
}) {
  const entries = buildHistory(milestones);
  if (entries.length === 0) return <div className="text-sm text-muted">No history yet.</div>;
  const days = groupByDay(entries);

  return (
    <div className="space-y-6">
      {days.map((day) => (
        <div key={day.date}>
          <div className="mb-2.5 ml-0.5 font-mono text-[11px] font-semibold tracking-[0.08em] text-muted">{day.date}</div>
          <ul className="relative list-none m-0 pl-0">
            {/* the rail runs through the centre of the 28px marker column */}
            <span className="pointer-events-none absolute left-[13px] top-3.5 bottom-3.5 w-0.5 bg-rule-2" aria-hidden="true" />
            {day.rows.map((e) => (
              <li key={e.id} className="relative grid grid-cols-[28px_auto_1fr] items-center gap-x-3 py-2.5">
                <span className="z-[1] flex h-7 w-7 items-center justify-center justify-self-center rounded-full border border-rule-2 bg-paper text-faint">
                  {e.byUser ? <IconUserSolid width={14} height={14} /> : <IconGearSolid width={14} height={14} />}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted whitespace-nowrap">{formatTime24(e.at)}</span>
                <span className="text-sm text-ink-soft"><EntryText e={e} serviceName={serviceName} /></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EntryText({ e, serviceName }: { e: HistoryEntry; serviceName?: string }) {
  if (e.kind === "request") {
    return (
      <>
        <span className="text-ink">{e.actor}</span> requested to <span className="text-ink">{e.lead}</span>
        {/* REGISTER assigns the device to a service. */}
        {e.attachService && serviceName && <> to <span className="text-ink">{serviceName}</span></>}.
      </>
    );
  }
  if (e.kind === "failed") {
    return (
      <>
        Failed to <span className="text-ink">{e.lead}</span>.
        {e.from && <> Device&rsquo;s state stayed <StateBadge type={e.from.type} label={e.from.name} />.</>}
      </>
    );
  }
  return (
    <>
      <span className="text-ink">{e.lead}</span>. <StateClause e={e} />
    </>
  );
}

function StateClause({ e }: { e: HistoryEntry }) {
  const badge = (s: { type: string; name: string }) => <StateBadge type={s.type} label={s.name} />;
  if (e.stateMode === "changed" && e.from && e.to) {
    return <>Device&rsquo;s state changed from {badge(e.from)} to {badge(e.to)}.</>;
  }
  if (e.stateMode === "set" && e.to) {
    return <>Device&rsquo;s state set to {badge(e.to)}.</>;
  }
  if (e.stateMode === "stayed" && (e.to || e.from)) {
    return <>Device&rsquo;s state stayed {badge((e.to ?? e.from)!)}.</>;
  }
  return null;
}
