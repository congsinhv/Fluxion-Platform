import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentSession, signIn as cognitoSignIn, signOut as cognitoSignOut, type CognitoSession } from "@/auth/cognito";
import { saveJwt, clearJwt } from "@/auth/jwt-store";

interface AuthContextValue {
  session: CognitoSession | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  loading: boolean;
}

const AuthCtx = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CognitoSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    currentSession().then((s) => {
      if (cancelled) return;
      if (s) {
        saveJwt(s.idToken);
        setSession(s);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const signIn = useCallback(async (u: string, p: string) => {
    const s = await cognitoSignIn(u, p);
    saveJwt(s.idToken);
    setSession(s);
  }, []);

  const signOut = useCallback(() => {
    cognitoSignOut();
    clearJwt();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut, loading }), [session, signIn, signOut, loading]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
