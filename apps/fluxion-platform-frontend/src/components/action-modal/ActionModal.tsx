import { useState } from "react";
import { useMutation } from "@apollo/client";
import { Modal } from "@/components/Modal";
import { StateBadge } from "@/components/StateBadge";
import { actionTransition } from "@/pages/config-actions-format";
import { useToast } from "@/components/Toast";
import {
  DispatchActionDocument,
  type DispatchActionMutation, type DispatchActionMutationVariables,
  type ListMessageTemplatesQuery, type ConfigMetadataQuery, type DeviceDetailQuery,
} from "@/graphql/generated/graphql";

type Device = NonNullable<DeviceDetailQuery["device"]>;
type Action = ConfigMetadataQuery["configMetadata"]["actions"][number];
type Template = ListMessageTemplatesQuery["listMessageTemplates"][number];

function describe(actionType: string): { title: string; cta: string; danger: boolean } {
  switch (actionType) {
    case "REGISTER":  return { title: "Register device", cta: "Register", danger: false };
    case "ACTIVATE":  return { title: "Activate device", cta: "Activate", danger: false };
    case "LOCK":      return { title: "Lock device", cta: "Lock device", danger: true };
    case "UNLOCK":    return { title: "Unlock device", cta: "Unlock", danger: false };
    case "NOTIFY_FROM_ACTIVE":
    case "NOTIFY_FROM_LOCKED": return { title: "Send notification", cta: "Send", danger: false };
    case "RELEASE_FROM_ACTIVE":
    case "RELEASE_FROM_LOCKED": return { title: "Release device", cta: "Release", danger: true };
    default: return { title: "Dispatch action", cta: "Confirm", danger: false };
  }
}

export function ActionModal({
  device, action, templates, onClose, onSuccess,
}: {
  device: Device;
  action: Action;
  templates: Template[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const meta = describe(action.type);
  const isNotify = action.type.startsWith("NOTIFY_");
  const requiresTemplate = action.templateRequired || isNotify;

  const [templateId, setTemplateId] = useState<string>(action.defaultTemplate?.id ?? templates[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const toast = useToast();

  const [dispatch] = useMutation<DispatchActionMutation, DispatchActionMutationVariables>(DispatchActionDocument);

  async function onConfirm() {
    setSubmitting(true);
    setErrMsg(null);
    try {
      await dispatch({
        variables: {
          input: {
            deviceId: device.id,
            actionType: action.type,
            ...(requiresTemplate && templateId ? { templateId } : {}),
          },
        },
      });
      toast.push("success", `${meta.title} queued`);
      onSuccess();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Dispatch failed";
      setErrMsg(msg);
      toast.push("error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={meta.title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="button"
            className={meta.danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            disabled={submitting || (requiresTemplate && !templateId)}
          >
            {submitting ? "Sending…" : meta.cta}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-muted">Device</div>
          <div className="font-mono text-ink">{device.imei}</div>
          <StateBadge type={device.currentState.type} label={device.currentState.name} />
        </div>

        <div className="text-ink-soft">
          {action.description ?? `Dispatch ${action.name} to this device.`}
          {(() => {
            const t = actionTransition(action);
            if (t.kind === "none") return null;
            return (
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-muted">State transition:</span>
                {t.kind === "transition" ? (
                  <span className="flex items-center gap-2">
                    <StateBadge type={t.from} /><span className="text-muted">→</span><StateBadge type={t.to} />
                  </span>
                ) : t.kind === "enter" ? (
                  <span className="flex items-center gap-2">
                    <span className="text-muted font-mono text-[10.5px] tracking-wide">None</span><span className="text-muted">→</span><StateBadge type={t.to} />
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <StateBadge type={t.from} /><span className="text-muted font-mono text-[10.5px] tracking-wide">unchanged</span>
                  </span>
                )}
              </div>
            );
          })()}
        </div>

        {requiresTemplate && (
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-muted font-mono">Message template</span>
            <select
              className="input mt-1"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="" disabled>Pick a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title} ({t.type})</option>
              ))}
            </select>
            {templates.length === 0 && (
              <div className="mt-2 text-xs text-state-locked">
                No templates available for this service. Create one in Templates first.
              </div>
            )}
          </label>
        )}

        {meta.danger && (
          <div className="text-xs p-3 rounded-md bg-state-bg-locked/40 border border-state-locked/30 text-state-locked">
            This is a destructive operator action.
          </div>
        )}

        {errMsg && <div className="text-sm text-state-locked">{errMsg}</div>}
      </div>
    </Modal>
  );
}
