import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useApolloClient } from "@apollo/client";
import { Link } from "react-router-dom";
import { Modal } from "@/components/Modal";
import { StateBadge } from "@/components/StateBadge";
import { IconCheck } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { UploadModalContext } from "@/components/upload-modal-context";
import {
  UploadImeiDocument, type UploadImeiMutation, type UploadImeiMutationVariables,
} from "@/graphql/generated/graphql";

const IMEI_RE = /^\d{15}$/;

// Single-IMEI upload as a modal — the fast path from the devices list / sidebar
// (no page navigation). Confirms inline on success, then Done closes; the
// device queries are refetched so the new device appears immediately.
function UploadImeiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [imei, setImei] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<UploadImeiMutation["uploadImei"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const client = useApolloClient();
  const [run] = useMutation<UploadImeiMutation, UploadImeiMutationVariables>(UploadImeiDocument);

  // Reset and focus each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setImei(""); setResult(null); setError(null); setSubmitting(false);
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  const valid = IMEI_RE.test(imei);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await run({ variables: { input: { imei } } });
      const upload = r.data?.uploadImei;
      if (upload) {
        setResult(upload);
        toast.push("success", `Upload ${upload.status.toLowerCase()}`);
        void client.reFetchObservableQueries();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
      toast.push("error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  const footer = result ? (
    <button type="button" onClick={onClose} className="btn-primary">Done</button>
  ) : (
    <>
      <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
      <button type="button" onClick={() => submit()} disabled={!valid || submitting} className="btn-primary">
        {submitting ? "Uploading…" : "Upload"}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title="Upload IMEI" maxWidth="max-w-md" footer={footer}>
      {result ? (
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-9 h-9 rounded-full bg-state-bg-active text-state-active flex items-center justify-center">
            <IconCheck width={18} height={18} />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-ink">
              {result.device ? "Device registered" : `Upload ${result.status.toLowerCase()}`}
            </div>
            <div className="mt-1 text-sm text-ink-soft leading-relaxed">
              <span className="font-mono">{result.imeiInput}</span>{" "}
              {result.device ? (
                <>entered the system as <StateBadge type={result.device.currentState.type} label={result.device.currentState.name} />.</>
              ) : (
                <span className="text-muted">was processed — see upload history for details.</span>
              )}
            </div>
            {result.device && (
              <Link to={`/devices/${result.device.id}`} onClick={onClose} className="mt-2 inline-block text-accent font-medium hover:underline">
                View device →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="text-sm text-muted leading-relaxed">
            Enter a 15-digit IMEI. The server resolves the TAC from the first 8 digits and registers the device.
          </p>
          <label className="block mt-4">
            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted">IMEI</span>
            <div className="relative mt-1.5">
              <input
                ref={inputRef}
                value={imei}
                onChange={(e) => setImei(e.target.value.replace(/\D/g, "").slice(0, 15))}
                inputMode="numeric"
                maxLength={15}
                placeholder="123456789012345"
                className="input font-mono text-base pr-16"
              />
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs tabular-nums ${valid ? "text-state-active" : "text-faint"}`}>
                {imei.length} / 15
              </span>
            </div>
          </label>
          {imei.length >= 8 && (
            <div className="mt-2 text-xs font-mono text-muted">
              TAC prefix <span className="text-ink-soft font-semibold">{imei.slice(0, 8)}</span> · resolves on upload
            </div>
          )}
          {error && <div className="mt-3 text-sm text-state-locked">{error}</div>}
        </form>
      )}
    </Modal>
  );
}

// Mounts the one shared modal and exposes `open()` via context to its subtree.
export function UploadModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <UploadModalContext.Provider value={api}>
      {children}
      <UploadImeiModal open={open} onClose={() => setOpen(false)} />
    </UploadModalContext.Provider>
  );
}
