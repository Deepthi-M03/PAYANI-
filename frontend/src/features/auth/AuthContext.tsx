import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { authApi, refreshSession, setAccessToken, type TokenResponse, type User } from "../../lib/api";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthState {
  status: Status;
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);

  const accept = useCallback((session: TokenResponse) => {
    setAccessToken(session.access_token);
    setUser(session.user);
    setStatus("authenticated");
    return session.user;
  }, []);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (session) accept(session);
        else setStatus("anonymous");
      })
      .catch(() => !cancelled && setStatus("anonymous"));
    return () => {
      cancelled = true;
    };
  }, [accept]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login: async (email, password) => accept(await authApi.login(email, password)),
      register: async (email, password, name) => accept(await authApi.register(email, password, name)),
      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          setAccessToken(null);
          setUser(null);
          setStatus("anonymous");
        }
      },
      can: (permission) => Boolean(user?.permissions.includes(permission)),
    }),
    [status, user, accept],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
