import { useRef, useState } from "react";
import { useQuery, useSubscription, useApolloClient } from "@apollo/client";
import { Link, useSearchParams } from "react-router-dom";
import { StateBadge } from "@/components/StateBadge";
import { ProviderBadge } from "@/components/ProviderBadge";
import { ErrorState } from "@/components/EmptyState";
import { IconSearch, IconRefresh, IconUpload } from "@/components/icons";
import { useUploadModal } from "@/components/upload-modal-context";
import { formatDateTimeFull } from "@/lib/format-date";
import { ListDevicesDocument, OnDeviceChangedDocument, type ListDevicesQuery, type StateType, type ServiceType } from "@/graphql/generated/graphql";

const SERVICE_TITLE: Record<string, string> = {
  DEVICE_FINANCING: "Device Financing",
  INVENTORY: "Inventory",
};

// Per-state description copy lifted verbatim from mockup-01 §page-head so
// the operator immediately knows what bucket they're staring at.
const STATE_DESCRIPTION: Record<string, string> = {
  IDLE: "Devices uploaded but not yet provisioned. Awaiting REGISTER from the DPC.",
  REGISTERED: "Devices ready to download the DPC. Awaiting ENROLL handshake.",
  ENROLLED: "DPC verified. Awaiting ACTIVATE before policy enforcement begins.",
  ACTIVE: "Devices in service — fully managed and reporting normal check-ins.",
  LOCKED: "Devices in LOCKED state — restricted access, awaiting Unlock or Release action.",
  RELEASED: "Devices removed from the financing program. No further enforcement.",
};

export function DevicesByStatePage() {
  const [params, setParams] = useSearchParams();
  const stateType = params.get("state") as StateType | null;
  const serviceType = params.get("service") as ServiceType | null;
  const [search, setSearch] = useState(params.get("q") ?? "");

  const client = useApolloClient();
  const upload = useUploadModal();
  // Refetches every active watchQuery on demand — same effect as the 10s poll.
  const onRefresh = () => { void client.reFetchObservableQueries(); };

  // Push: any device transition refreshes the list. onDeviceChanged is a
  // fleet-wide broadcast, so coalesce bursts (e.g. bulk enroll/lock) into a
  // single trailing refetch instead of one per event — prevents a refetch
  // storm. The 10s poll remains the floor.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSubscription(OnDeviceChangedDocument, {
    onData: () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        void client.reFetchObservableQueries();
      }, 700);
    },
  });

  const { data, loading, error } = useQuery<ListDevicesQuery>(ListDevicesDocument, {
    variables: {
      stateType: stateType ?? undefined,
      serviceType: serviceType ?? undefined,
      search: search.trim() ? search.trim() : undefined,
      first: 100,
    },
    pollInterval: 10_000,
    notifyOnNetworkStatusChange: false,
  });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value && value !== "ALL") next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  }

  // The platform only supports DPC-provisioned devices; hide any other provider.
  const rows = (data?.listDevices.edges ?? []).filter(
    ({ node }) => node.tac.provider.toUpperCase() === "DPC",
  );
  const totalCount = rows.length;

  // Page-head variant matches mockup-01 § page-head: when filtered to a
  // specific state, show big state badge + service title + description.
  // Otherwise generic "Devices" header.
  const headTitle = serviceType ? SERVICE_TITLE[serviceType] ?? "Devices" : "Devices";
  const headDesc = stateType ? STATE_DESCRIPTION[stateType] : "All devices across every service and state.";

  return (
    <>
      {/* Full-bleed header: border aligns with the sidebar brand divider. */}
      <div className="border-b border-rule">
        <div className="mx-auto max-w-[1180px] px-8 min-h-[96px] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-tight text-ink flex items-center gap-3">
              <span>{headTitle}</span>
              {stateType && <StateBadge type={stateType} label={stateType} />}
            </h1>
            <p className="mt-1 text-[13.5px] text-muted max-w-[640px]">{headDesc}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onRefresh} className="btn-secondary text-[13px]" aria-label="Refresh all data">
              <IconRefresh width={14} height={14} />
              <span>Refresh</span>
            </button>
            <button type="button" onClick={upload.open} className="btn-primary text-[13px]">
              <IconUpload width={14} height={14} />
              <span>Upload IMEI</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content: search toolbar + table live in ONE card so they read as a
          single object instead of three floating bands. */}
      <div className="mx-auto max-w-[1180px] px-8 pt-6 pb-8">
        {error && <ErrorState message={error.message} />}
        {!error && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-rule bg-paper-2">
              <div className="relative w-72">
                <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  placeholder="Search IMEI…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setParam("q", e.target.value || null); }}
                  className="input pl-8"
                />
              </div>
              <span className="text-[13px] text-muted tabular-nums shrink-0">
                <strong className="text-ink font-semibold">{totalCount}</strong> device{totalCount !== 1 ? "s" : ""}
              </span>
            </div>

            {loading && rows.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center">
                <div className="text-base font-medium text-ink-soft">No devices match the current filter</div>
                <div className="mt-2 text-sm text-muted">Adjust state pills or service filter, or clear the search.</div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-paper-2 text-xs uppercase tracking-wider text-ink-soft font-mono border-b border-rule-2">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2">IMEI</th>
                    <th className="text-left font-semibold px-4 py-2">Provider</th>
                    <th className="text-left font-semibold px-4 py-2">Device</th>
                    <th className="text-left font-semibold px-4 py-2">Service</th>
                    <th className="text-left font-semibold px-4 py-2">State</th>
                    <th className="text-right font-semibold px-4 py-2">Last changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map(({ node }) => (
                    <tr key={node.id} className="hover:bg-paper-2 transition-colors">
                      <td className="px-4 py-2 font-mono tabular-nums whitespace-nowrap">
                        <Link to={`/devices/${node.id}`} className="text-ink font-medium hover:text-accent hover:underline">{node.imei}</Link>
                      </td>
                      <td className="px-4 py-2"><ProviderBadge provider={node.tac.provider} /></td>
                      <td className="px-4 py-2 leading-tight">
                        <div className="text-ink-soft">{node.tac.model}</div>
                        <div className="text-xs text-muted">{node.tac.manufacturer}</div>
                      </td>
                      <td className="px-4 py-2 text-ink-soft">{node.service.name}</td>
                      <td className="px-4 py-2"><StateBadge type={node.currentState.type} label={node.currentState.name} /></td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums whitespace-nowrap">
                        {node.updatedAt ? formatDateTimeFull(node.updatedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </>
  );
}
