import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, bindSession, refreshSession, type AuthUser } from "../api/client";

interface Session {
  accessToken: string;
  user: AuthUser;
}

interface AuthState {
  session: Session | null;
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

export class MfaRequiredError extends Error {
  constructor(readonly mfaToken: string) {
    super("Enter the authenticator code.");
    this.name = "MfaRequiredError";
  }
}

export class MfaEnrollmentError extends Error {
  constructor(
    readonly mfaToken: string,
    readonly secret: string,
    readonly otpauth: string,
  ) {
    super("Enroll an authenticator before this operator can sign in.");
    this.name = "MfaEnrollmentError";
  }
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{
      accessToken?: string;
      user?: AuthUser;
      mfaRequired?: boolean;
      mfaEnrollmentRequired?: boolean;
      mfaToken?: string;
      secret?: string;
      otpauth?: string;
    }>("/api/v1/auth/login", null, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (data.mfaEnrollmentRequired && data.mfaToken && data.secret && data.otpauth) {
      throw new MfaEnrollmentError(data.mfaToken, data.secret, data.otpauth);
    }
    if (data.mfaRequired && data.mfaToken) throw new MfaRequiredError(data.mfaToken);
    if (!data.accessToken || !data.user) throw new Error("Sign-in did not return a session.");
    if (data.user.role === "USER" || data.user.role === "GUARDIAN") {
      await api("/api/v1/auth/logout", null, { method: "POST", body: JSON.stringify({}) });
      throw new Error("This account cannot open the monitoring hub.");
    }
    setSession({ accessToken: data.accessToken, user: data.user });
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const data = await api<{ accessToken: string; user: AuthUser }>("/api/v1/auth/mfa", null, {
      method: "POST",
      body: JSON.stringify({ mfaToken, code }),
    });
    if (data.user.role === "USER" || data.user.role === "GUARDIAN") {
      throw new Error("This account cannot open the monitoring hub.");
    }
    setSession({ accessToken: data.accessToken, user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await api("/api/v1/auth/logout", null, { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
    setSession(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then(async (token) => {
        if (cancelled || !token) return;
        const user = await api<AuthUser>("/api/v1/users/me", token);
        if (cancelled) return;
        if (user.role === "USER" || user.role === "GUARDIAN") return;
        setSession({ accessToken: token, user });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bindSession(session?.accessToken ?? null, (token) => {
      setSession((current) => {
        if (!current || !token || current.accessToken === token) return token ? current : null;
        return { ...current, accessToken: token };
      });
    });
  }, [session?.accessToken]);

  const value = useMemo(() => ({ session, restoring, login, completeMfa, logout }), [session, restoring, login, completeMfa, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
