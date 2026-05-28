import { useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { ListMessageTemplatesDocument, type ListMessageTemplatesQuery, type ConfigMetadataQuery, type DeviceDetailQuery } from "@/graphql/generated/graphql";
import { ActionModal } from "@/components/action-modal/ActionModal";
import { availableActions, isDispatchDisabled } from "@/components/action-availability";
import {
  IconChevronDown, IconLock, IconUnlock, IconBell, IconPower, IconUserCheck, IconLogout, IconBolt,
} from "@/components/icons";

type Device = NonNullable<DeviceDetailQuery["device"]>;
type Action = ConfigMetadataQuery["configMetadata"]["actions"][number];

function actionGlyph(type: string) {
  if (type === "LOCK") return IconLock;
  if (type === "UNLOCK") return IconUnlock;
  if (type === "ACTIVATE") return IconPower;
  if (type === "REGISTER") return IconUserCheck;
  if (type.startsWith("NOTIFY")) return IconBell;
  if (type.startsWith("RELEASE")) return IconLogout;
  return IconBolt;
}
const isDanger = (type: string) => type === "LOCK" || type.startsWith("RELEASE");

// Page-head "Actions ▾" dropdown. Closed by default; disabled (with a pulsing
// "Pending · <action>" pill) while a command is awaiting device ACK. Replaces
// the old sticky right-side dispatch panel but keeps the lazy per-service
// template prefetch so the Notify modal opens without a spinner.
export function ActionsDropdown({
  device,
  configActions,
  onDispatched,
}: {
  device: Device;
  configActions: Action[];
  onDispatched: () => void;
}) {
  const actions = availableActions(device, configActions);
  const disabled = isDispatchDisabled(device);
  const [picked, setPicked] = useState<Action | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const templatesQ = useQuery<ListMessageTemplatesQuery>(ListMessageTemplatesDocument, {
    variables: { serviceType: device.service.type },
    fetchPolicy: "cache-first",
  });

  function pick(a: Action) {
    setPicked(a);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <div className="flex items-center gap-2.5">
      {disabled && device.assignedAction && (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10.5px] font-semibold uppercase tracking-wider bg-state-bg-registered text-state-registered"
          title="An action is queued — wait for the device to ACK before dispatching another."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-state-registered animate-pulse" />
          Pending · {device.assignedAction.name}
        </span>
      )}

      <details
        ref={detailsRef}
        className="relative group"
        {...(disabled ? { "aria-disabled": true } : {})}
        onToggle={(e) => { if (disabled) (e.currentTarget as HTMLDetailsElement).open = false; }}
      >
        <summary
          data-actions-trigger
          aria-disabled={disabled}
          className={
            "list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-2 px-3.5 py-[7px] rounded-md text-[13px] font-medium border transition-colors " +
            (disabled
              ? "bg-paper-2 text-muted border-rule-2 cursor-not-allowed"
              : "bg-accent text-white border-accent shadow-sm hover:bg-accent-dark hover:border-accent-dark cursor-pointer")
          }
        >
          Actions
          <IconChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
        </summary>

        {!disabled && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[165px] bg-paper border border-rule rounded-lg shadow-lg p-1.5">
            <div className="px-2.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted font-semibold">
              From {device.currentState.name}
            </div>
            {actions.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-muted">No operator actions available.</div>
            )}
            {actions.map((a) => {
              const Glyph = actionGlyph(a.type);
              const danger = isDanger(a.type);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick(a)}
                  className={
                    "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] font-medium text-left transition-colors " +
                    (danger ? "text-state-locked hover:bg-state-bg-locked" : "text-ink hover:bg-paper-2")
                  }
                >
                  <Glyph className={"w-4 h-4 flex-shrink-0 " + (danger ? "text-state-locked" : "text-muted")} />
                  <span>{a.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </details>

      {picked && (
        <ActionModal
          device={device}
          action={picked}
          templates={templatesQ.data?.listMessageTemplates ?? []}
          onClose={() => setPicked(null)}
          onSuccess={() => { setPicked(null); onDispatched(); }}
        />
      )}
    </div>
  );
}
