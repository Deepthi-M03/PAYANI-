import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router";

import { Alert } from "../../design-system/Alert";
import { Button } from "../../design-system/Button";
import { FullPageLoader } from "../../design-system/FullPageLoader";
import { useAuth } from "./AuthContext";

/** Gate a route on being signed in and, optionally, holding a permission.
 * This only hides UI: the API enforces every permission independently. */
export function RequireAuth({ children, permission }: { children: ReactNode; permission?: string }) {
  const { status, signedOut, can, retry } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (status === "loading") return <FullPageLoader />;
  if (status === "unavailable") {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <Alert tone="warning" title={t("common.unavailableTitle")}>
          {t("common.unavailableBody")}
        </Alert>
        <Button onClick={retry}>{t("common.retry")}</Button>
      </div>
    );
  }
  if (status === "anonymous" && signedOut) return <Navigate to="/" replace />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (permission && !can(permission)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
