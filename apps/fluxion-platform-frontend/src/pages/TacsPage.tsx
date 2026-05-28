import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { IconPlus, IconTrash, IconEdit, IconSearch } from "@/components/icons";
import {
  ListTacsDocument, CreateTacDocument, UpdateTacDocument, DeleteTacDocument,
  type ListTacsQuery,
} from "@/graphql/generated/graphql";

type Tac = ListTacsQuery["listTacs"]["edges"][number]["node"];

export function TacsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Tac | "new" | null>(null);
  const toast = useToast();

  const { data, loading, error, refetch } = useQuery<ListTacsQuery>(ListTacsDocument, {
    variables: { search: search.trim() ? search.trim() : undefined, first: 200 },
  });

  const [doDelete] = useMutation(DeleteTacDocument);

  async function onDelete(t: Tac) {
    if (!confirm(`Delete TAC ${t.tac}?`)) return;
    try {
      await doDelete({ variables: { tac: t.tac } });
      toast.push("success", "TAC deleted");
      await refetch();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Delete failed");
    }
  }

  const rows = data?.listTacs.edges ?? [];

  return (
    <>
      <PageHeader
        title="TACs"
        subtitle="Type Allocation Codes — first 8 digits of an IMEI map to a make/model."
        actions={<button type="button" className="btn-primary" onClick={() => setEditing("new")}><IconPlus /> New TAC</button>}
      />
      <div className="px-8 py-4">
        <div className="relative max-w-md">
          <IconSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input pl-8"
            placeholder="Search TAC / manufacturer / model…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
          />
        </div>
      </div>
      <div className="px-8 pb-8">
        {error && <ErrorState message={error.message} />}
        {loading && rows.length === 0 && !error && <LoadingState />}
        {!loading && !error && rows.length === 0 && (
          <EmptyState title="No TACs match" hint="Create a TAC so devices in that range can register." />
        )}
        {rows.length > 0 && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-2 text-xs uppercase tracking-wider text-muted font-mono sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-2">TAC</th>
                  <th className="text-left px-4 py-2">Provider</th>
                  <th className="text-left px-4 py-2">Manufacturer</th>
                  <th className="text-left px-4 py-2">Model</th>
                  <th className="text-left px-4 py-2">Updated</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map(({ node }) => (
                  <tr key={node.id} className="hover:bg-paper-2">
                    <td className="px-4 py-3 font-mono tabular-nums">{node.tac}</td>
                    <td className="px-4 py-3 text-ink-soft">{node.provider}</td>
                    <td className="px-4 py-3 text-ink-soft">{node.manufacturer}</td>
                    <td className="px-4 py-3 text-ink">{node.model}</td>
                    <td className="px-4 py-3 text-muted tabular-nums">{new Date(node.updatedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn-secondary p-1.5" onClick={() => setEditing(node)} aria-label="Edit"><IconEdit /></button>
                        <button type="button" className="btn-secondary p-1.5 hover:text-state-locked" onClick={() => onDelete(node)} aria-label="Delete"><IconTrash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && (
        <TacEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </>
  );
}

// Provider is a free string column (default 'DPC'); the editor offers the two
// known enrollment providers as a writable dropdown.
const PROVIDERS = ["DPC", "Google"];

function TacEditor({ initial, onClose, onSaved }: { initial: Tac | null; onClose: () => void; onSaved: () => void }) {
  const [tac, setTac] = useState(initial?.tac ?? "");
  const [provider, setProvider] = useState(initial?.provider ?? PROVIDERS[0]);
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const [doCreate] = useMutation(CreateTacDocument);
  const [doUpdate] = useMutation(UpdateTacDocument);

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      if (initial) {
        // updateTac per schema: tac (immutable key) + provider + model.
        await doUpdate({ variables: { input: { tac: initial.tac, provider, model } } });
        toast.push("success", "TAC updated");
      } else {
        if (!/^\d{8}$/.test(tac)) throw new Error("TAC must be 8 digits");
        await doCreate({ variables: { input: { tac, provider, manufacturer, model } } });
        toast.push("success", "TAC created");
      }
      onSaved();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Save failed";
      setErr(m); toast.push("error", m);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open onClose={onClose}
      title={initial ? `Edit TAC ${initial.tac}` : "New TAC"}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button" className="btn-primary"
            onClick={onSave}
            disabled={saving || !model || (!initial && (!tac || !manufacturer))}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">TAC (8 digits)</span>
          <input
            className="input mt-1 font-mono"
            value={tac}
            onChange={(e) => setTac(e.target.value.replace(/\D/g, ""))}
            disabled={!!initial}
            maxLength={8}
            required
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Provider</span>
          <select className="input mt-1" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Manufacturer</span>
          <input
            className="input mt-1" value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            disabled={!!initial}
            required
          />
          {initial && <div className="text-xs text-muted mt-1">Manufacturer is immutable per schema.</div>}
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Model</span>
          <input className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)} required />
        </label>
        {err && <div className="text-sm text-state-locked">{err}</div>}
      </div>
    </Modal>
  );
}
