import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@apollo/client";
import { PageHeader } from "@/components/PageHeader";
import { LoadingState, ErrorState, EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { IconPlus, IconTrash, IconEdit } from "@/components/icons";
import {
  ListMessageTemplatesDocument, CreateMessageTemplateDocument, UpdateMessageTemplateDocument, DeleteMessageTemplateDocument,
  type ListMessageTemplatesQuery, type MessageTemplateType, type ServiceType,
} from "@/graphql/generated/graphql";

type Template = ListMessageTemplatesQuery["listMessageTemplates"][number];

const TYPES: MessageTemplateType[] = ["POPUP" as MessageTemplateType, "FULLSCREEN" as MessageTemplateType];

export function TemplatesPage() {
  // serviceType is derived from the sidebar route (?service=), not a selector;
  // ListMessageTemplates still requires a valid serviceType, so default to the
  // financing service when the param is absent.
  const [params] = useSearchParams();
  const service = (params.get("service") ?? "DEVICE_FINANCING") as ServiceType;
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const toast = useToast();

  const { data, loading, error, refetch } = useQuery<ListMessageTemplatesQuery>(ListMessageTemplatesDocument, {
    variables: { serviceType: service },
  });

  const [doDelete] = useMutation(DeleteMessageTemplateDocument);

  async function onDelete(t: Template) {
    if (!confirm(`Delete template "${t.title}"?`)) return;
    try {
      await doDelete({ variables: { id: t.id } });
      toast.push("success", "Template deleted");
      await refetch();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Reusable notification + lock-screen messages."
        actions={
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            <IconPlus /> New template
          </button>
        }
      />
      <div className="px-8 py-6">
        {error && <ErrorState message={error.message} />}
        {loading && !data && !error && <LoadingState />}
        {!loading && !error && (data?.listMessageTemplates.length ?? 0) === 0 && (
          <EmptyState title="No templates yet" hint="Create one to enable NOTIFY actions." action={
            <button type="button" className="btn-primary" onClick={() => setEditing("new")}><IconPlus /> New</button>
          } />
        )}
        {(data?.listMessageTemplates.length ?? 0) > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data!.listMessageTemplates.map((t) => (
              <article key={t.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink">{t.title}</div>
                    <div className="text-xs text-muted font-mono mt-0.5">{t.type}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="btn-secondary p-1.5" onClick={() => setEditing(t)} aria-label="Edit"><IconEdit /></button>
                    <button type="button" className="btn-secondary p-1.5 hover:text-state-locked" onClick={() => onDelete(t)} aria-label="Delete"><IconTrash /></button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-ink-soft whitespace-pre-wrap line-clamp-6">{t.content}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <TemplateEditor
          serviceType={service}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refetch(); }}
        />
      )}
    </>
  );
}

function TemplateEditor({
  initial, serviceType, onClose, onSaved,
}: {
  initial: Template | null;
  serviceType: ServiceType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [type, setType] = useState<MessageTemplateType>(initial?.type ?? TYPES[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const [doCreate] = useMutation(CreateMessageTemplateDocument);
  const [doUpdate] = useMutation(UpdateMessageTemplateDocument);

  async function onSave() {
    setSaving(true);
    setErr(null);
    try {
      if (initial) {
        await doUpdate({ variables: { input: { id: initial.id, title, content, type } } });
        toast.push("success", "Template updated");
      } else {
        await doCreate({ variables: { input: { serviceType, title, content, type } } });
        toast.push("success", "Template created");
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
      title={initial ? "Edit template" : "New template"}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving || !title || !content}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Title</span>
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Type</span>
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as MessageTemplateType)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-mono">Content</span>
          <textarea className="input mt-1 min-h-[140px]" value={content} onChange={(e) => setContent(e.target.value)} required />
        </label>
        {err && <div className="text-sm text-state-locked">{err}</div>}
      </div>
    </Modal>
  );
}
