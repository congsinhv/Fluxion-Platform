import { describe, it, expect } from "vitest";
import {
  describeMilestone, buildHistory, groupByDay, type HistoryMilestone,
} from "@/components/device-history-format";

const m = (o: Partial<HistoryMilestone>): HistoryMilestone => ({
  id: "x", eventType: "APPLIED", createdAt: "2026-05-28T23:00:00Z",
  action: { type: "ACTIVATE", name: "Activate" }, ...o,
});

describe("describeMilestone", () => {
  it("APPLIED renders the past-tense phrase and a changed state clause", () => {
    const e = describeMilestone(m({
      eventType: "APPLIED", action: { type: "ACTIVATE", name: "Activate" },
      fromState: { type: "ENROLLED", name: "Enrolled" }, toState: { type: "ACTIVE", name: "Active" },
    }));
    expect(e.kind).toBe("transition");
    expect(e.byUser).toBe(false);
    expect(e.lead).toBe("Device activated");
    expect(e.stateMode).toBe("changed");
  });

  it("in-place APPLIED (same from/to) reports stayed", () => {
    const e = describeMilestone(m({
      eventType: "APPLIED", action: { type: "NOTIFY_FROM_ACTIVE", name: "Notify" },
      fromState: { type: "ACTIVE", name: "Active" }, toState: { type: "ACTIVE", name: "Active" },
    }));
    expect(e.lead).toBe("Notification sent");
    expect(e.stateMode).toBe("stayed");
  });

  it("REQUESTED by a user uses the imperative phrase and the user marker", () => {
    const e = describeMilestone(m({
      eventType: "REQUESTED", action: { type: "REGISTER", name: "Register" },
      requestedBy: { email: "admin@fluxion.test" },
    }));
    expect(e.kind).toBe("request");
    expect(e.byUser).toBe(true);
    expect(e.actor).toBe("admin@fluxion.test");
    expect(e.lead).toBe("register the device");
    expect(e.attachService).toBe(true);
  });

  it("REQUESTED without requestedBy is attributed to System with the gear marker", () => {
    const e = describeMilestone(m({ eventType: "REQUESTED", requestedBy: null }));
    expect(e.byUser).toBe(false);
    expect(e.actor).toBe("System");
  });

  it("unknown action types fall back to the display name, never blank", () => {
    const e = describeMilestone(m({ eventType: "APPLIED", action: { type: "MYSTERY", name: "Do Thing" } }));
    expect(e.lead).toBe("Do Thing applied");
  });

  it("UPLOAD APPLIED is the origin row: 'Device uploaded' set to the initial state", () => {
    const e = describeMilestone(m({
      eventType: "APPLIED", action: { type: "UPLOAD", name: "Upload" },
      fromState: null, toState: { type: "IDLE", name: "Idle" },
    }));
    expect(e.lead).toBe("Device uploaded");
    expect(e.stateMode).toBe("set");
  });

  it("UPLOAD REQUESTED uses the imperative phrase", () => {
    const e = describeMilestone(m({
      eventType: "REQUESTED", action: { type: "UPLOAD", name: "Upload" },
      requestedBy: { email: "synh@fluxion.com" },
    }));
    expect(e.actor).toBe("synh@fluxion.com");
    expect(e.lead).toBe("upload the device");
  });
});

describe("buildHistory + groupByDay", () => {
  // Midday-UTC, two days apart, so day grouping is stable across timezones.
  const reg = m({ id: "reg", eventType: "APPLIED", createdAt: "2026-05-27T12:00:00Z",
    action: { type: "REGISTER", name: "Register" },
    fromState: { type: "IDLE", name: "Idle" }, toState: { type: "REGISTERED", name: "Registered" } });
  const act = m({ id: "act", eventType: "APPLIED", createdAt: "2026-05-29T12:00:00Z",
    fromState: { type: "ENROLLED", name: "Enrolled" }, toState: { type: "ACTIVE", name: "Active" } });

  it("sorts newest-first, one row per milestone (no synthetic rows)", () => {
    const entries = buildHistory([reg, act]);
    expect(entries.map((e) => e.id)).toEqual(["act", "reg"]); // newest first
  });

  it("groups consecutive entries by calendar day", () => {
    const days = groupByDay(buildHistory([reg, act]));
    expect(days.map((d) => d.rows.length)).toEqual([1, 1]); // act on the 29th, reg on the 28th
    expect(days.length).toBe(2);
  });
});
