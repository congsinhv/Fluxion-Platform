import { useState } from "react";
import { useQuery, useSubscription } from "@apollo/client";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "@/components/EmptyState";
import { useUploadModal } from "@/components/upload-modal-context";
import {
  ListDeviceUploadsDocument,
  OnDeviceUploadChangedDocument,
  type ListDeviceUploadsQuery,
  type UploadStatus,
} from "@/graphql/generated/graphql";

const STATUSES: { value: UploadStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "PROCESSING" as UploadStatus, label: "Processing" },
  { value: "COMPLETED" as UploadStatus, label: "Completed" },
];

export function UploadHistoryPage() {
  const [status, setStatus] = useState<UploadStatus | "ALL">("ALL");
  const upload = useUploadModal();
  const { data, loading, error, refetch } = useQuery<ListDeviceUploadsQuery>(
    ListDeviceUploadsDocument,
    {
      variables: { status: status === "ALL" ? undefined : status, first: 100 },
      pollInterval: 10_000,
    },
  );

  // Push: a new/changed upload refreshes the list immediately.
  useSubscription(OnDeviceUploadChangedDocument, {
    onData: () => { void refetch(); },
  });

  const rows = data?.listDeviceUploads.edges ?? [];

  return (
    <>
      <PageHeader title="Upload history" subtitle="Single and batch IMEI imports across the platform, with status and result." actions={<button type="button" onClick={upload.open} className="btn-primary">New upload</button>} />
      <div className="px-8 py-4 flex items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStatus(s.value)}
            className={
              "pill border " + (status === s.value
                ? "bg-accent-soft border-accent text-accent"
                : "bg-paper border-rule text-ink-soft hover:bg-paper-2")
            }
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="px-8 pb-8">
        {error && <ErrorState message={error.message} />}
        {loading && rows.length === 0 && !error && <LoadingState />}
        {!loading && !error && rows.length === 0 && <EmptyState title="No uploads yet" hint="Upload an IMEI to see it here." />}
        {rows.length > 0 && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-xs uppercase tracking-wider text-muted font-mono sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-2">When</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-left px-4 py-2">IMEI / file</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">By</th>
                  <th className="text-left px-4 py-2">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map(({ node }) => (
                  <tr key={node.id} className="hover:bg-paper-2">
                    <td className="px-4 py-3 text-ink-soft tabular-nums">{new Date(node.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{node.source}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{node.imeiInput ?? node.fileName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={
                        "pill " + (node.status === "COMPLETED"
                          ? "bg-state-bg-active text-state-active"
                          : "bg-state-bg-registered text-state-registered")
                      }>{node.status}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{node.uploadedBy.displayName ?? node.uploadedBy.email}</td>
                    <td className="px-4 py-3">
                      {node.device ? (
                        <Link to={`/devices/${node.device.id}`} className="text-accent hover:underline font-mono tabular-nums">{node.device.imei}</Link>
                      ) : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
