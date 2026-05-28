import type { ConfigMetadataQuery, DeviceDetailQuery } from "@/graphql/generated/graphql";

type Device = NonNullable<DeviceDetailQuery["device"]>;
type Action = ConfigMetadataQuery["configMetadata"]["actions"][number];

// OPERATOR actions whose fromState matches the device's current state AND
// service. Keying off the action's *fromState* service (not the action's own
// service) is what lets onboarding actions appear while the device is still in
// its origin service — REGISTER transitions from IDLE (Inventory) into a Device
// Financing state, so it must be dispatchable on an Inventory device. SYSTEM
// actions are auto-issued by the backend and must never appear in the dropdown.
export function availableActions(device: Device, all: Action[]): Action[] {
  return all.filter((a) =>
    a.actor === "OPERATOR" &&
    a.fromState?.type === device.currentState.type &&
    a.fromState?.service.type === device.service.type,
  );
}

// Single-flight gate: a non-null assignedAction means a command is already
// queued and awaiting device ACK, so the dropdown must be disabled.
export function isDispatchDisabled(device: Pick<Device, "assignedAction">): boolean {
  return !!device.assignedAction;
}
