import { useSearchParams } from "react-router-dom";
import { useQuery } from "@apollo/client";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { LoadingState, ErrorState } from "@/components/EmptyState";
import { actionTransition } from "@/pages/config-actions-format";
import {
  ConfigMetadataDocument, type ConfigMetadataQuery,
} from "@/graphql/generated/graphql";

const SERVICE_LABEL: Record<string, string> = {
  DEVICE_FINANCING: "Device Financing",
  INVENTORY: "Inventory",
};

export function ConfigActionsPage() {
  // serviceType derives from the sidebar route (?service=); default to the
  // primary financing service when the param is absent.
  const [params] = useSearchParams();
  const service = params.get("service") ?? "DEVICE_FINANCING";
  const serviceLabel = SERVICE_LABEL[service] ?? service;

  const { data, loading, error } = useQuery<ConfigMetadataQuery>(ConfigMetadataDocument);
  if (loading && !data) return <><PageHeader title={`Actions · ${serviceLabel}`} subtitle="Read-only" /><div className="px-8 py-6"><LoadingState /></div></>;
  if (error) return <><PageHeader title={`Actions · ${serviceLabel}`} /><div className="px-8 py-6"><ErrorState message={error.message} /></div></>;

  const actions = (data?.configMetadata.actions ?? []).filter((a) => a.service.type === service);

  return (
    <>
      <PageHeader title={`Actions · ${serviceLabel}`} subtitle="Read-only — the state-machine transitions for this service." />
      <div className="px-8 py-6">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper-2 text-xs uppercase tracking-wider text-muted font-mono">
              <tr>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Actor</th>
                <th className="text-left px-4 py-2.5">From → To</th>
                <th className="text-left px-4 py-2.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {actions.map((a) => {
                const t = actionTransition(a);
                return (
                  <tr key={a.id} className="hover:bg-paper-2">
                    <td className="px-4 py-3 font-medium text-ink">{a.name}</td>
                    <td className="px-4 py-3"><ActorTag actor={a.actor} /></td>
                    <td className="px-4 py-3">
                      {t.kind === "transition" ? (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <StateBadge type={t.from} /><span className="text-muted">→</span><StateBadge type={t.to} />
                        </span>
                      ) : t.kind === "unchanged" ? (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <StateBadge type={t.from} /><span className="text-muted font-mono text-[10.5px] tracking-wide">unchanged</span>
                        </span>
                      ) : t.kind === "enter" ? (
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="text-muted font-mono text-[10.5px] tracking-wide">None</span><span className="text-muted">→</span><StateBadge type={t.to} />
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{a.description ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ActorTag({ actor }: { actor: string }) {
  const isOperator = actor === "OPERATOR";
  return (
    <span className={
      "font-mono text-[10.5px] px-1.5 py-0.5 rounded tracking-wide " +
      (isOperator ? "bg-accent-soft text-accent-dark" : "bg-state-bg-enrolled text-state-enrolled")
    }>
      {actor}
    </span>
  );
}
