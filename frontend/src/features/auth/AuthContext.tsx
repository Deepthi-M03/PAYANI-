import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { authApi, refreshSession, setAccessToken, type TokenResponse, type User } from "../../lib/api";

/** "unavailable": the server did not answer (it may still be starting). Not the same as signed out. */
type Status = "loading" | "authenticated" | "anonymous" | "unavailable";

interface AuthState {
  status: Status;
  /** True after the person chose to sign out, so protected pages send them home, not to /login. */
  signedOut: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Try restoring the session again after the server was unavailable. */
  retry: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const accept = useCallback((session: TokenResponse) => {
    setAccessToken(session.access_token);
    setUser(session.user);
    setStatus("authenticated");
    setSignedOut(false);
    return session.user;
  }, []);

  // Restore the session from the refresh cookie on first load (and on retry).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (session) accept(session);
        else setStatus("anonymous");
      })
      // The refresh call only throws when the server could not be reached; being signed
      // out is a normal 401 handled above.
      .catch(() => !cancelled && setStatus("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [accept, attempt]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      signedOut,
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
          setSignedOut(true);
        }
      },
      retry,
      can: (permission) => Boolean(user?.permissions.includes(permission)),
    }),
    [status, signedOut, user, accept, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
