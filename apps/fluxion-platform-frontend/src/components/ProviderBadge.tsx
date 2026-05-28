// Provisioning provider shown as a pill. The platform currently supports only
// DPC (Android Device Policy Controller); DPC is accented, anything else is
// rendered muted so unexpected providers stand out.
export function ProviderBadge({ provider }: { provider: string }) {
  const isDpc = provider.toUpperCase() === "DPC";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium font-mono ${isDpc ? "bg-accent-soft text-accent" : "bg-rule text-muted"}`}>
      {provider}
    </span>
  );
}
