import { useSearchParams } from "react-router-dom";
import { useQuery } from "@apollo/client";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState } from "@/components/EmptyState";
import {
  ConfigMetadataDocument, type ConfigMetadataQuery,
} from "@/graphql/generated/graphql";

const SERVICE_LABEL: Record<string, string> = {
  DEVICE_FINANCING: "Device Financing",
  INVENTORY: "Inventory",
};

export function ConfigStatesPage() {
  // serviceType derives from the sidebar route (?service=); default financing.
  const [params] = useSearchParams();
  const service = params.get("service") ?? "DEVICE_FINANCING";
  const serviceLabel = SERVICE_LABEL[service] ?? service;

  const { data, loading, error } = useQuery<ConfigMetadataQuery>(ConfigMetadataDocument);
  if (loading && !data) return <><PageHeader title={`States · ${serviceLabel}`} subtitle="Read-only" /><div className="px-8 py-6"><LoadingState /></div></>;
  if (error) return <><PageHeader title={`States · ${serviceLabel}`} /><div className="px-8 py-6"><ErrorState message={error.message} /></div></>;

  const states = (data?.configMetadata.states ?? []).filter((s) => s.service.type === service);

  return (
    <>
      <PageHeader title={`States · ${serviceLabel}`} subtitle="Read-only — defined in the platform seed." />
      <div className="px-8 py-6">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper-2 text-xs uppercase tracking-wider text-muted font-mono">
              <tr>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Color</th>
                <th className="text-left px-4 py-2.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {states.map((s) => (
                <tr key={s.id} className="hover:bg-paper-2">
                  <td className="px-4 py-3 text-ink font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-sm border border-rule-2 flex-shrink-0" style={{ background: s.color ?? "transparent" }} />
                      <span className="font-mono text-xs text-ink-soft">{(s.color ?? "").toUpperCase() || "—"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{s.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
