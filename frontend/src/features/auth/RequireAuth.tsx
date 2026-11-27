import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { FullPageLoader } from "../../design-system/FullPageLoader";
import { useAuth } from "./AuthContext";

/** Gate a route on being signed in and, optionally, holding a permission.
 * This only hides UI: the API enforces every permission independently. */
export function RequireAuth({ children, permission }: { children: ReactNode; permission?: string }) {
  const { status, can } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (permission && !can(permission)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
