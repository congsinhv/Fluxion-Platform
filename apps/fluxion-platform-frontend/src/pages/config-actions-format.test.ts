import { describe, it, expect } from "vitest";
import { actionTransition } from "@/pages/config-actions-format";

describe("actionTransition", () => {
  it("returns a transition pair when from and to differ", () => {
    expect(actionTransition({ fromState: { type: "IDLE" }, targetState: { type: "REGISTERED" } }))
      .toEqual({ kind: "transition", from: "IDLE", to: "REGISTERED" });
  });

  it("returns unchanged when there is no target state (NOTIFY)", () => {
    expect(actionTransition({ fromState: { type: "ACTIVE" }, targetState: null }))
      .toEqual({ kind: "unchanged", from: "ACTIVE" });
  });

  it("returns unchanged when target equals from", () => {
    expect(actionTransition({ fromState: { type: "LOCKED" }, targetState: { type: "LOCKED" } }))
      .toEqual({ kind: "unchanged", from: "LOCKED" });
  });

  it("returns enter when there is no from state but a target (entry action)", () => {
    expect(actionTransition({ fromState: null, targetState: { type: "IDLE" } }))
      .toEqual({ kind: "enter", to: "IDLE" });
  });

  it("returns none when there is neither a from nor a target state", () => {
    expect(actionTransition({ fromState: null, targetState: null }))
      .toEqual({ kind: "none" });
  });
});
