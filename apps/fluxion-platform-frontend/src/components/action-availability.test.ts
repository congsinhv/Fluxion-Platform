import { describe, it, expect } from "vitest";
import { availableActions, isDispatchDisabled } from "@/components/action-availability";

// Minimal shapes — only the fields the predicates read. Cast through unknown
// to satisfy the codegen types without building full objects.
const mk = (o: unknown) => o as never;

// Actions encode the action's own service AND the fromState's service. The
// fromState service is what the predicate keys off (cross-service onboarding).
const ACTIONS = [
  { id: "1", actor: "OPERATOR", type: "LOCK", service: { type: "DEVICE_FINANCING" }, fromState: { type: "ACTIVE", service: { type: "DEVICE_FINANCING" } } },
  { id: "2", actor: "OPERATOR", type: "RELEASE_FROM_ACTIVE", service: { type: "DEVICE_FINANCING" }, fromState: { type: "ACTIVE", service: { type: "DEVICE_FINANCING" } } },
  { id: "3", actor: "SYSTEM", type: "ENROLL", service: { type: "DEVICE_FINANCING" }, fromState: { type: "ACTIVE", service: { type: "DEVICE_FINANCING" } } },
  // REGISTER bridges Inventory → Device Financing: defined under DEVICE_FINANCING
  // but transitions from INVENTORY/IDLE.
  { id: "4", actor: "OPERATOR", type: "REGISTER", service: { type: "DEVICE_FINANCING" }, fromState: { type: "IDLE", service: { type: "INVENTORY" } } },
  // Hypothetical wrong-service action: fromState belongs to INVENTORY/ACTIVE
  // (which doesn't really exist) — must NOT appear for a DEVICE_FINANCING device.
  { id: "5", actor: "OPERATOR", type: "X", service: { type: "INVENTORY" }, fromState: { type: "ACTIVE", service: { type: "INVENTORY" } } },
];

const activeDevice = { service: { type: "DEVICE_FINANCING" }, currentState: { type: "ACTIVE" }, assignedAction: null };
const idleInventoryDevice = { service: { type: "INVENTORY" }, currentState: { type: "IDLE" }, assignedAction: null };

describe("availableActions", () => {
  it("keeps only OPERATOR actions matching fromState's service + current state", () => {
    const got = availableActions(mk(activeDevice), mk(ACTIONS)).map((a) => a.id);
    expect(got).toEqual(["1", "2"]); // LOCK + RELEASE; SYSTEM/wrong-state/wrong-fromState-service excluded
  });

  it("excludes SYSTEM actions even when the state matches", () => {
    const got = availableActions(mk(activeDevice), mk(ACTIONS));
    expect(got.some((a) => a.actor === "SYSTEM")).toBe(false);
  });

  // Regression: D5 — REGISTER must appear on an IDLE/Inventory device, even
  // though the action is defined under the DEVICE_FINANCING service. Without
  // this an admin has no UI affordance to onboard an uploaded device.
  it("surfaces REGISTER on an Inventory/IDLE device (cross-service onboarding)", () => {
    const got = availableActions(mk(idleInventoryDevice), mk(ACTIONS)).map((a) => a.type);
    expect(got).toEqual(["REGISTER"]);
  });
});

describe("isDispatchDisabled", () => {
  it("is false when no action is assigned", () => {
    expect(isDispatchDisabled(mk({ assignedAction: null }))).toBe(false);
  });
  it("is true when an action is pending", () => {
    expect(isDispatchDisabled(mk({ assignedAction: { id: "9", type: "UNLOCK", name: "Unlock" } }))).toBe(true);
  });
});
