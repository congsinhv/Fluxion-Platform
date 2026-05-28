import { useMemo, type ReactNode } from "react";
import { useQuery, useSubscription } from "@apollo/client";
import { useParams } from "react-router-dom";
import { StateBadge } from "@/components/StateBadge";
import { ProviderBadge } from "@/components/ProviderBadge";
import { LoadingState, ErrorState } from "@/components/EmptyState";
import { DeviceHistory } from "@/components/DeviceHistory";
import { type HistoryMilestone } from "@/components/device-history-format";
import { ActionsDropdown } from "@/components/ActionDispatchPanel";
import { IconRefreshSolid } from "@/components/icons";
import { formatDateTimeFull } from "@/lib/format-date";
import {
  DeviceDetailDocument, DeviceMilestonesDocument, ConfigMetadataDocument,
  OnDeviceUpdatedDocument,
  type DeviceDetailQuery, type DeviceMilestonesQuery, type ConfigMetadataQuery,
} from "@/graphql/generated/graphql";

const EYEBROW = "mb-4 font-mono text-[10.5px] font-semibold uppercase tracking-[0.15em] text-faint";

// One label-above-value line in the device-info panel.
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-[13.5px] text-ink">{children}</dd>
    </div>
  );
}

export function DeviceDetailPage() {
  const { id = "" } = useParams<{ id: string }>();

  const device = useQuery<DeviceDetailQuery>(DeviceDetailDocument, {
    variables: { id }, pollInterval: 10_000, skip: !id,
  });
  const milestones = useQuery<DeviceMilestonesQuery>(DeviceMilestonesDocument, {
    variables: { deviceId: id, first: 50 }, pollInterval: 10_000, skip: !id,
  });
  const config = useQuery<ConfigMetadataQuery>(ConfigMetadataDocument);

  // Push: refetch this device + its milestones the instant a transition lands,
  // instead of waiting for the 10s poll. Server-filtered to this deviceId.
  useSubscription(OnDeviceUpdatedDocument, {
    variables: { deviceId: id },
    skip: !id,
    onData: () => {
      void device.refetch();
      void milestones.refetch();
    },
  });

  // Cast through unknown so codegen's Maybe<…> aliases line up with the
  // history component's looser shape without per-field null checks here.
  const nodes = useMemo(
    () => (milestones.data?.listMilestones.edges ?? []).map((e) => e.node) as unknown as HistoryMilestone[],
    [milestones.data],
  );

  if (!id) return <ErrorState message="Missing device id" />;
  if (device.loading && !device.data) return <LoadingState />;
  if (device.error) return <ErrorState message={device.error.message} />;
  if (!device.data?.device) return <ErrorState message="Device not found" />;

  const d = device.data.device;
  const refresh = () => { device.refetch(); milestones.refetch(); };

  return (
    // Fixed-height column so only the history scrolls — the page itself doesn't.
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Full-bleed header — border lines up with the sidebar brand divider. */}
      <div className="border-b border-rule shrink-0">
        <div className="mx-auto max-w-[1180px] px-8 py-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <span className="font-mono text-[26px] font-semibold tracking-tight text-ink leading-none">{d.imei}</span>
              <StateBadge type={d.currentState.type} label={d.currentState.name} />
              <button
                type="button"
                onClick={refresh}
                className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-lg border border-rule-2 bg-sunk text-muted hover:bg-rule hover:text-ink transition-colors"
                title="Refresh"
                aria-label="Refresh"
              >
                <IconRefreshSolid width={15} height={15} />
              </button>
            </div>
            <p className="mt-2.5 text-[13px] text-muted">
              <span className="text-ink-soft">{d.tac.manufacturer} {d.tac.model}</span>
              <span className="mx-2 text-rule-2">·</span>{d.service.name}
              <span className="mx-2 text-rule-2">·</span>Last changed{" "}
              <span className="font-mono tabular-nums">{formatDateTimeFull(d.updatedAt)}</span>
            </p>
          </div>
          <ActionsDropdown
            device={d}
            configActions={config.data?.configMetadata.actions ?? []}
            onDispatched={refresh}
          />
        </div>
      </div>

      {/* Device info (calm left panel) + history (wide right column). */}
      <div className="flex-1 min-h-0 w-full max-w-[1180px] mx-auto px-8 py-6">
        <div className="grid grid-cols-[328px_1fr] h-full overflow-hidden rounded-xl border border-rule">
          <aside className="bg-paper-2 border-r border-rule px-6 py-6 overflow-y-auto">
            <p className={EYEBROW}>Device info</p>
            <dl>
              <div>
                <InfoRow label="IMEI"><span className="font-mono tabular-nums">{d.imei}</span></InfoRow>
                <InfoRow label="TAC"><span className="font-mono tabular-nums">{d.tac.tac}</span></InfoRow>
                <InfoRow label="Manufacturer">{d.tac.manufacturer}</InfoRow>
                <InfoRow label="Model">{d.tac.model}</InfoRow>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-rule">
                <InfoRow label="Provider"><ProviderBadge provider={d.tac.provider} /></InfoRow>
                <InfoRow label="Service">{d.service.name}</InfoRow>
                <InfoRow label="Current state"><StateBadge type={d.currentState.type} label={d.currentState.name} /></InfoRow>
                <InfoRow label="Assigned action">{d.assignedAction?.name ?? <span className="text-faint">none</span>}</InfoRow>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-rule">
                <InfoRow label="First check-in"><span className="font-mono tabular-nums">{d.firstCheckinAt ? formatDateTimeFull(d.firstCheckinAt) : "—"}</span></InfoRow>
                <InfoRow label="Last check-in"><span className="font-mono tabular-nums">{d.lastCheckinAt ? formatDateTimeFull(d.lastCheckinAt) : "—"}</span></InfoRow>
              </div>
            </dl>
          </aside>

          <section className="px-8 py-7 min-w-0 overflow-y-auto">
            <p className={EYEBROW}>Device history</p>
            {milestones.loading && nodes.length === 0 && <LoadingState />}
            {milestones.error && <ErrorState message={milestones.error.message} />}
            {!milestones.error && (
              <DeviceHistory milestones={nodes} serviceName={d.service.name} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
