import { Outlet, Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/auth/AuthContext";
import { useUploadModal } from "@/components/upload-modal-context";
import {
  IconHistory, IconTemplate, IconTag, IconLogout, IconUpload, IconChevronRight,
  IconBox, IconCard, IconLayers, IconBolt,
} from "@/components/icons";

// Editorial Cream sidebar (mirrors docs/design-proposals/_shared/sidebar.html).
//   DEVICES → collapsible Inventory / Device Financing groups, one link per
//     state. No status dots, no device-count badges.
//   CONFIGURATION → collapsible States / Actions (split by service) +
//     collapsible Message Templates (Device Financing child) + flat TACs.
//   Flat Upload IMEI / Upload History links.
// Deep-link contract preserved: state rows → /devices?service=X&state=Y so
// DevicesByStatePage keeps filtering off the URL. Config service children and
// the templates child carry ?service= so those pages derive their serviceType
// from the route. Active state is derived from pathname + ?service= + ?state=
// (NavLink ignores search params, so we compute it ourselves).
type ServiceKey = "INVENTORY" | "DEVICE_FINANCING";
type StateRow = { state: string; label: string };

const INVENTORY_STATES: StateRow[] = [{ state: "IDLE", label: "Idle" }];
const FINANCING_STATES: StateRow[] = [
  { state: "REGISTERED", label: "Registered" },
  { state: "ENROLLED", label: "Enrolled" },
  { state: "ACTIVE", label: "Active" },
  { state: "LOCKED", label: "Locked" },
  { state: "RELEASED", label: "Released" },
];

export function Shell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const upload = useUploadModal();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const urlService = params.get("service");
  const urlState = params.get("state");

  const stateHref = (svc: ServiceKey, st: string) => `/devices?service=${svc}&state=${st}`;
  const isStateActive = (svc: string, st: string) =>
    loc.pathname === "/devices" && urlService === svc && urlState === st;

  const configHref = (base: string, svc: ServiceKey) => `${base}?service=${svc}`;
  const isConfigActive = (base: string, svc: string) =>
    loc.pathname === base && urlService === svc;

  // A group opens by default when its active item is the current route.
  const financingActive = loc.pathname === "/devices" && urlService === "DEVICE_FINANCING";
  const inventoryActive = loc.pathname === "/devices" && urlService === "INVENTORY";
  const statesActive = loc.pathname === "/config/states";
  const actionsActive = loc.pathname === "/config/actions";
  const templatesActive = loc.pathname === "/templates";

  const userEmail = session?.email ?? "";
  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <div className="grid grid-cols-[260px_1fr] min-h-screen">
      <aside className="sticky top-0 h-screen bg-sidebar text-ink-soft border-r border-rule-2 flex flex-col overflow-y-auto">
        {/* Brand */}
        <div className="px-5 py-3 min-h-[96px] border-b border-rule-2 flex items-center gap-2.5 bg-white/40">
          <img src={logo} alt="Fluxion" className="w-[30px] h-[30px]" />
          <div>
            <div className="text-ink font-semibold text-[15px] leading-tight">Fluxion</div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted font-medium mt-0.5 font-mono">MDM Console</div>
          </div>
        </div>

        {/* DEVICES */}
        <div className="px-3 pt-3.5 pb-1.5">
          <SectionLabel to="/devices">Devices</SectionLabel>

          <NavGroup id="inventory" icon={<IconBox className="w-4 h-4" />} label="Inventory" defaultOpen={inventoryActive}>
            {INVENTORY_STATES.map((s) => (
              <SubLink key={s.state} to={stateHref("INVENTORY", s.state)} active={isStateActive("INVENTORY", s.state)} label={s.label} />
            ))}
          </NavGroup>

          <NavGroup id="financing" icon={<IconCard className="w-4 h-4" />} label="Device Financing" defaultOpen={financingActive || (!inventoryActive && loc.pathname !== "/devices")}>
            {FINANCING_STATES.map((s) => (
              <SubLink key={s.state} to={stateHref("DEVICE_FINANCING", s.state)} active={isStateActive("DEVICE_FINANCING", s.state)} label={s.label} />
            ))}
          </NavGroup>

          <button
            type="button"
            onClick={upload.open}
            className="flex items-center gap-2.5 w-full px-3 py-[7px] rounded-md text-[13px] my-px font-medium text-ink-soft hover:bg-sidebar-hover transition-colors text-left"
          >
            <span className="text-ink-soft flex-shrink-0"><IconUpload width={16} height={16} /></span>
            <span>Upload IMEI</span>
          </button>
          <FlatLink to="/upload/history" icon={<IconHistory width={16} height={16} />} label="Upload History" end />
        </div>

        <div className="h-px bg-rule-2 mx-3 my-2" />

        {/* CONFIGURATION */}
        <div className="px-3 pb-3">
          <SectionLabel>Configuration</SectionLabel>

          <NavGroup id="states" icon={<IconLayers className="w-4 h-4" />} label="States" defaultOpen={statesActive}>
            <SubLink to={configHref("/config/states", "INVENTORY")} active={isConfigActive("/config/states", "INVENTORY")} label="Inventory" />
            <SubLink to={configHref("/config/states", "DEVICE_FINANCING")} active={isConfigActive("/config/states", "DEVICE_FINANCING")} label="Device Financing" />
          </NavGroup>

          <NavGroup id="actions" icon={<IconBolt className="w-4 h-4" />} label="Actions" defaultOpen={actionsActive}>
            <SubLink to={configHref("/config/actions", "INVENTORY")} active={isConfigActive("/config/actions", "INVENTORY")} label="Inventory" />
            <SubLink to={configHref("/config/actions", "DEVICE_FINANCING")} active={isConfigActive("/config/actions", "DEVICE_FINANCING")} label="Device Financing" />
          </NavGroup>

          <NavGroup id="templates" icon={<IconTemplate width={16} height={16} />} label="Message Templates" defaultOpen={templatesActive}>
            <SubLink to={configHref("/templates", "DEVICE_FINANCING")} active={isConfigActive("/templates", "DEVICE_FINANCING")} label="Device Financing" />
          </NavGroup>

          <FlatLink to="/tacs" icon={<IconTag width={16} height={16} />} label="TACs" end />
        </div>

        {/* Footer */}
        <div className="mt-auto px-4 py-[14px] border-t border-rule-2 flex items-center gap-2.5 text-xs bg-white/40">
          <div className="w-[30px] h-[30px] rounded-full bg-accent text-white flex items-center justify-center font-semibold text-[11px] font-mono">{initials || "—"}</div>
          <div className="flex-1 min-w-0">
            <div className="text-ink font-semibold text-[12.5px] truncate">Admin</div>
            <div className="text-muted text-[10.5px] truncate font-mono" title={userEmail}>{userEmail}</div>
          </div>
          <button
            type="button"
            onClick={() => { signOut(); navigate("/login"); }}
            className="text-muted hover:text-ink p-1.5 rounded-md hover:bg-sidebar-hover"
            aria-label="Sign out"
          >
            <IconLogout width={14} height={14} />
          </button>
        </div>
      </aside>

      <main className="bg-bg text-ink flex flex-col min-w-0">
        <div className="flex-1 overflow-x-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SectionLabel({ children, to }: { children: React.ReactNode; to?: string }) {
  const cls = "block text-[10px] uppercase tracking-[0.12em] text-muted font-semibold px-3 pb-2 font-mono";
  return to ? (
    <Link to={to} className={`${cls} hover:text-ink transition-colors`}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function NavGroup({
  id, icon, label, defaultOpen, children,
}: { id: string; icon: React.ReactNode; label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details data-nav-group={id} open={defaultOpen} className="my-px [&[open]>summary>.chev]:rotate-90">
      <summary className="flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] font-medium cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-sidebar-hover text-ink-soft">
        <span className="text-ink-soft flex-shrink-0">{icon}</span>
        <span className="flex-1">{label}</span>
        <IconChevronRight className="chev w-3.5 h-3.5 text-muted transition-transform flex-shrink-0" />
      </summary>
      <div className="pt-0.5 pb-1.5">{children}</div>
    </details>
  );
}

function SubLink({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={
        "block pl-[38px] pr-3 py-[5px] rounded-md text-[12.5px] my-px transition-colors " +
        (active ? "bg-sidebar-2 text-ink font-semibold" : "text-ink-soft hover:bg-sidebar-hover hover:text-ink")
      }
    >
      {label}
    </Link>
  );
}

function FlatLink({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        "flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] my-px font-medium transition-colors " +
        (isActive ? "bg-sidebar-2 text-ink font-semibold" : "text-ink-soft hover:bg-sidebar-hover")
      }
    >
      <span className="text-ink-soft flex-shrink-0">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
