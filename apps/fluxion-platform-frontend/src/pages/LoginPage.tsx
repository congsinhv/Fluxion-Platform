import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import logo from "@/assets/logo.svg";
import { useAuth } from "@/auth/AuthContext";

export function LoginPage() {
  const { signIn, session } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Navigate as a component avoids the React anti-pattern of calling
  // useNavigate() during render (which warns + double-fires under StrictMode).
  // Post-successful-signIn the same Navigate path fires because `session`
  // flips to non-null from AuthContext.
  if (session) {
    return <Navigate to={loc.state?.from ?? "/devices"} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username, password);
      // signIn flips `session` non-null → component re-renders → Navigate fires.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  const Brand = (
    <div className="flex items-center gap-3">
      <img src={logo} alt="Fluxion" className="w-[42px] h-[42px]" />
      <div>
        <div className="text-[17px] font-bold leading-none text-ink">Fluxion</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted font-mono">MDM Console</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-2 bg-paper">
      {/* Brand panel — editorial statement. Desktop only; on mobile the form
          carries a compact lockup instead. */}
      <div className="hidden lg:flex flex-col bg-paper-2 border-r border-rule px-12 py-10">
        {Brand}
        <h1 className="mt-auto max-w-[440px] text-[34px] font-extrabold tracking-tight leading-[1.12] text-ink">
          The control plane for your managed devices.
        </h1>
        <p className="mt-4 max-w-[400px] text-sm leading-relaxed text-muted">
          Provision, monitor, and manage your entire Android device estate from a single console.
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[320px]">
          <div className="mb-8 lg:hidden">{Brand}</div>
          <h2 className="text-[22px] font-bold text-ink mb-6">Sign in</h2>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.13em] text-muted font-mono font-semibold">Email</span>
              <input
                className="input mt-1.5 text-[15px]"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.13em] text-muted font-mono font-semibold">Password</span>
              <input
                className="input mt-1.5 text-[15px]"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <div className="text-sm text-state-locked">{error}</div>}
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
