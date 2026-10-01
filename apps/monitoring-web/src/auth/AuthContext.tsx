import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, bindSession, type AuthUser } from "../api/client";

interface Session {
  accessToken: string;
  user: AuthUser;
}

interface AuthState {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; user: AuthUser }>("/api/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (data.user.role === "USER" || data.user.role === "GUARDIAN" || data.user.role === "RESPONDER") {
      await api("/api/v1/auth/logout", null, { method: "POST", body: JSON.stringify({}) });
      throw new Error("This account cannot open the monitoring hub.");
    }
    setSession({ accessToken: data.accessToken, user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await api("/api/v1/auth/logout", null, { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
    setSession(null);
  }, []);

  useEffect(() => {
    bindSession(session?.accessToken ?? null, (token) => {
      setSession((current) => {
        if (!current || !token || current.accessToken === token) return token ? current : null;
        return { ...current, accessToken: token };
      });
    });
  }, [session?.accessToken]);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
