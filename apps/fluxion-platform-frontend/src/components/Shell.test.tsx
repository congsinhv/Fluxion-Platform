import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Shell } from "@/components/Shell";

// Isolate Shell from Cognito (AuthContext): the contract under test is the
// sidebar's nav structure + URL-driven active state, not data fetching.
vi.mock("@/auth/AuthContext", () => ({
  useAuth: () => ({ session: { email: "admin@fluxion.test" }, signOut: vi.fn(), signIn: vi.fn(), loading: false }),
}));

function renderShell(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route path="*" element={<div data-testid="outlet" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Shell sidebar", () => {
  it("renders every device state link with the /devices?service=X&state=Y deep-link contract", () => {
    renderShell("/devices");
    const expected: Record<string, string> = {
      Idle: "/devices?service=INVENTORY&state=IDLE",
      Registered: "/devices?service=DEVICE_FINANCING&state=REGISTERED",
      Enrolled: "/devices?service=DEVICE_FINANCING&state=ENROLLED",
      Active: "/devices?service=DEVICE_FINANCING&state=ACTIVE",
      Locked: "/devices?service=DEVICE_FINANCING&state=LOCKED",
      Released: "/devices?service=DEVICE_FINANCING&state=RELEASED",
    };
    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("marks the device state link matching the URL triple as active", () => {
    renderShell("/devices?service=DEVICE_FINANCING&state=ACTIVE");
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("aria-current", "page");
    // Sibling state in the same service must NOT be active.
    expect(screen.getByRole("link", { name: "Locked" })).not.toHaveAttribute("aria-current", "page");
  });

  it("renders collapsible groups for Inventory and Device Financing under Devices", () => {
    const { container } = renderShell("/devices");
    expect(container.querySelector('details[data-nav-group="inventory"]')).not.toBeNull();
    expect(container.querySelector('details[data-nav-group="financing"]')).not.toBeNull();
  });

  it("config service child links carry serviceType in the route", () => {
    const { container } = renderShell("/config/states?service=DEVICE_FINANCING");
    const statesGroup = container.querySelector('details[data-nav-group="states"]') as HTMLElement;
    expect(statesGroup).not.toBeNull();
    expect(within(statesGroup).getByRole("link", { name: "Device Financing" }))
      .toHaveAttribute("href", "/config/states?service=DEVICE_FINANCING");
  });

  it("Message Templates child link carries a serviceType param", () => {
    const { container } = renderShell("/templates?service=DEVICE_FINANCING");
    const tplGroup = container.querySelector('details[data-nav-group="templates"]') as HTMLElement;
    expect(tplGroup).not.toBeNull();
    expect(within(tplGroup).getByRole("link", { name: "Device Financing" }))
      .toHaveAttribute("href", "/templates?service=DEVICE_FINANCING");
  });

  it("does not render numeric device-count badges", () => {
    const { container } = renderShell("/devices");
    expect(container.querySelector("[data-count-badge]")).toBeNull();
  });
});
